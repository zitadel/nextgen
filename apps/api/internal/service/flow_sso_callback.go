package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/idp"
)

var errSSOCallbackMixUp = errors.New("sso callback answered by another connection")

// refusedEventType is the event a callback refused before its exchange is
// recorded with, chosen like for any other callback: a failure after a code
// arrived is an exchange failure, a callback without one an authorization
// failure.
func refusedEventType(in FlowSSOCallbackInput) domain.EventType {
	if in.Code == "" {
		return domain.EventTypeAuthSSOAuthorizationFailed
	}
	return domain.EventTypeAuthSSOExchangeFailed
}

// oauthErrorAccessDenied is the one authorization error code that means the
// person declined (RFC 6749 §4.1.2.1).
const oauthErrorAccessDenied = "access_denied"

// FlowSSOCallback finishes an external sign-in when the provider redirects
// the browser back: it consumes the state record, exchanges the code, and
// stores the outcome on the record for the next flow render to pick up.
type FlowSSOCallback struct {
	connections IDPConnectionService
	attempts    AuthAttemptService
	keys        KeyService
	variables   VariableService
	// httpClient is the hardened egress client; the token endpoint is a
	// tenant-authored URL (ADR 061).
	httpClient *http.Client
}

func NewFlowSSOCallback(connections IDPConnectionService, attempts AuthAttemptService, keys KeyService, variables VariableService, httpClient *http.Client) *FlowSSOCallback {
	return &FlowSSOCallback{connections: connections, attempts: attempts, keys: keys, variables: variables, httpClient: httpClient}
}

// FlowSSOCallbackInput is the provider's redirect, picked apart by the
// handler.
type FlowSSOCallbackInput struct {
	// Issuer is the authorization response's `iss` (RFC 9207), empty when
	// the provider sent none.
	Issuer string
	// ConnectionSlug is the connection the callback path names: each
	// connection has its own redirect URI, so it says which provider sent the
	// browser back.
	ConnectionSlug string
	// State is the state query value, verbatim.
	State string
	// Code is the authorization code; empty when the provider failed.
	Code string
	// BindingNonce is the browser's binding cookie value, empty when the
	// cookie is absent.
	BindingNonce string
	// Error, ErrorDescription and ErrorURI are the provider's authorization
	// error response (RFC 6749 §4.1.2.1), all empty on success.
	Error            string
	ErrorDescription string
	ErrorURI         string
}

type FlowSSOCallbackOutput struct {
	// ReturnTarget is where the browser goes next: the page the sign-in
	// started on, stored on the record at submit.
	ReturnTarget string
	// Failure is the ceremony's failure, when it had one: the key the step
	// shows and the cause the handler logs with the redirect (ADR 030).
	// Nil when the ceremony succeeded.
	Failure *domain.FlowStepFailure
	// ProjectID and Slug name the project and the connection, for that line.
	ProjectID string
	Slug      string
}

// Process consumes the state record and stores the ceremony's outcome on it.
// Any failure after the consume, the provider's, the configuration's or this
// process's, is stored as a generic error key and returned as the output's
// Failure, and the browser still goes back to the return target, where the
// originating step shows the error. Process itself returns an error only when
// the state cannot be consumed or the outcome cannot be stored: for both, the
// handler answers its uniform error page.
func (c *FlowSSOCallback) Process(ctx context.Context, in FlowSSOCallbackInput) (FlowSSOCallbackOutput, error) {
	// The project is read from the state because the lookup needs one and
	// this request carries no other project source. A state without one is
	// answered exactly like an unknown state.
	projectID := domain.SSOStateProjectID(in.State)
	if projectID == "" {
		return FlowSSOCallbackOutput{}, domain.ErrSSOStateInvalid()
	}
	check, err := c.attempts.ConsumeSSOState(ctx, projectID, in.State, in.BindingNonce)
	if err != nil {
		return FlowSSOCallbackOutput{}, err
	}
	// Bound only after the consume: until a record matches, the project
	// comes from the query alone.
	audit.BindPublicRequest(ctx, projectID, "", "")
	pending := check.Pending

	if in.ConnectionSlug != pending.ProviderSlug {
		return c.fail(ctx, projectID, check, fmt.Errorf("%w: the callback path names connection %q, the state pins %q", errSSOCallbackMixUp, in.ConnectionSlug, pending.ProviderSlug), refusedEventType(in))
	}

	var conn idp.Connection
	var connErr error
	if in.Issuer != "" || (in.Error == "" && in.Code != "") {
		conn, connErr = c.pinnedConnection(ctx, projectID, pending)
	}
	if in.Issuer != "" && connErr == nil && in.Issuer != conn.OIDC.Issuer {
		return c.fail(ctx, projectID, check, fmt.Errorf("%w: the callback's iss %q is not the issuer %q of connection %q", errSSOCallbackMixUp, in.Issuer, conn.OIDC.Issuer, pending.ProviderSlug), refusedEventType(in))
	}
	if in.Error != "" {
		if connErr != nil {
			getLoggingContext(ctx, "flow").Warn("sso callback could not check the iss of a provider error",
				slog.String("project_id", projectID),
				slog.String("slug", pending.ProviderSlug),
				slog.Any("error", connErr),
			)
		}
		// access_denied is the person saying no and gets its own key. Every
		// other code is the provider failing.
		key := domain.FlowStepErrorSSOFailed
		if in.Error == oauthErrorAccessDenied {
			key = domain.FlowStepErrorSSOCancelled
		}
		// The description and URI go to the operator's line and are never
		// stored: the user sees only the localized key.
		cause := fmt.Errorf("the provider answered %q: %q (%s)", in.Error, in.ErrorDescription, in.ErrorURI)
		return c.park(ctx, projectID, check, domain.FlowStepFailed(key, cause), domain.EventTypeAuthSSOAuthorizationFailed)
	}

	if in.Code == "" {
		return c.fail(ctx, projectID, check, errors.New("the callback carried neither a code nor an error"), domain.EventTypeAuthSSOAuthorizationFailed)
	}

	if connErr != nil {
		return c.fail(ctx, projectID, check, connErr, domain.EventTypeAuthSSOExchangeFailed)
	}
	deploymentID, err := c.deploymentID(ctx, projectID, check.AuthAttemptID)
	if err != nil {
		return c.fail(ctx, projectID, check, err, domain.EventTypeAuthSSOExchangeFailed)
	}
	identity, err := c.exchange(ctx, projectID, deploymentID, in.Code, pending, conn)
	if err != nil {
		return c.fail(ctx, projectID, check, err, domain.EventTypeAuthSSOExchangeFailed)
	}
	result := &domain.SSOCallbackResult{
		Subject:              identity.Subject,
		ConnectionRevisionID: identity.RevisionID,
		Claims:               identity.Claims,
		Verified:             identity.Verified,
	}
	if err := c.attempts.SetSSOCallbackResult(ctx, projectID, check, result, domain.EventTypeAuthSSOExchangeSucceeded); err != nil {
		// The row was replaced or removed, so storing the error key would
		// fail the same way.
		if errors.Is(err, domain.ErrSSOStateInvalid()) {
			return FlowSSOCallbackOutput{}, err
		}
		return c.fail(ctx, projectID, check, domain.ErrInternal(err), domain.EventTypeAuthSSOExchangeFailed)
	}
	return FlowSSOCallbackOutput{ReturnTarget: pending.ReturnTarget, ProjectID: projectID, Slug: pending.ProviderSlug}, nil
}

func (c *FlowSSOCallback) pinnedConnection(ctx context.Context, projectID string, pending *domain.SSOStatePayload) (idp.Connection, error) {
	connection, err := c.connections.GetRevision(ctx, projectID, pending.ConnectionRevisionID)
	if err != nil {
		return idp.Connection{}, err
	}
	return idp.ParseConnection(connection.RevisionID, connection.Document)
}

func (c *FlowSSOCallback) deploymentID(ctx context.Context, projectID, attemptID string) (string, error) {
	if attemptID == "" {
		return "", nil
	}
	attempt, err := c.attempts.GetByID(ctx, projectID, attemptID)
	if err != nil {
		return "", err
	}
	return attempt.DeploymentID, nil
}

func (c *FlowSSOCallback) exchange(ctx context.Context, projectID, deploymentID, code string, pending *domain.SSOStatePayload, conn idp.Connection) (idp.ExternalIdentity, error) {
	if err := resolveSSOClientID(ctx, c.variables, projectID, deploymentID, &conn); err != nil {
		return idp.ExternalIdentity{}, err
	}
	secret, err := c.resolveClientSecret(ctx, projectID, deploymentID, conn)
	if err != nil {
		return idp.ExternalIdentity{}, err
	}
	verifier, err := pending.DecryptPKCEVerifier(decrypterOfWritingKey(ctx, c.keys))
	if err != nil {
		return idp.ExternalIdentity{}, err
	}
	client, err := idp.NewOIDCClient(ctx, conn, pending.RedirectURI, c.httpClient)
	if err != nil {
		return idp.ExternalIdentity{}, err
	}
	return client.Callback(ctx, idp.CallbackRequest{
		Code:         code,
		Nonce:        pending.OIDCNonce,
		PKCEVerifier: verifier,
		RedirectURI:  pending.RedirectURI,
		RevisionID:   pending.ConnectionRevisionID,
		ClientSecret: secret,
	})
}

// resolveClientSecret reads the secret for the token exchange from the
// variable the connection names. A plain value is refused: it is readable
// through the variables surface, and refusing it makes the misconfiguration
// visible.
func (c *FlowSSOCallback) resolveClientSecret(ctx context.Context, projectID, deploymentID string, conn idp.Connection) (string, error) {
	name, ok := domain.VariableReferenceName(conn.OIDC.ClientSecretRef)
	if !ok {
		// The schema accepts only a whole-value `${{ NAME }}` reference. The
		// value is not echoed: it may be a pasted secret, and this error is
		// logged.
		return "", errors.New("client_secret is not a variable reference")
	}
	secret, err := secretVariable(ctx, c.variables, decrypterOfWritingKey(ctx, c.keys), projectID, deploymentID, name)
	if err != nil {
		return "", err
	}
	if secret == "" {
		return "", fmt.Errorf("client_secret variable %q is missing, not a secret, or not a string", name)
	}
	return secret, nil
}

// fail stores the generic failure key with eventType and hands the cause the
// user must not see to the handler's line. An internal error is still stored,
// so the user can retry from the step: the state is already consumed, and the
// error page has no way back.
func (c *FlowSSOCallback) fail(ctx context.Context, projectID string, check *domain.SSOCallbackCheck, cause error, eventType domain.EventType) (FlowSSOCallbackOutput, error) {
	return c.park(ctx, projectID, check, domain.FlowStepFailed(domain.FlowStepErrorSSOFailed, cause), eventType)
}

// park stores the failure's key on the consumed record, emitting eventType,
// and sends the browser back to the return target, where the originating
// step shows the key.
func (c *FlowSSOCallback) park(ctx context.Context, projectID string, check *domain.SSOCallbackCheck, failure *domain.FlowStepFailure, eventType domain.EventType) (FlowSSOCallbackOutput, error) {
	result := &domain.SSOCallbackResult{ErrorKey: failure.Key}
	if err := c.attempts.SetSSOCallbackResult(ctx, projectID, check, result, eventType); err != nil {
		return FlowSSOCallbackOutput{}, err
	}
	return FlowSSOCallbackOutput{
		ReturnTarget: check.Pending.ReturnTarget,
		Failure:      failure,
		ProjectID:    projectID,
		Slug:         check.Pending.ProviderSlug,
	}, nil
}
