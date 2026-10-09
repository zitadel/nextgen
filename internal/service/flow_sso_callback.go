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

// errSSOCallbackMixUp marks a callback that names another connection than
// the one its state pins, by its path or by its `iss`.
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
}

// Process consumes the state record and stores the ceremony's outcome on it.
// Any failure after the consume, the provider's, the configuration's or this
// process's, is stored as a generic error key and logged, and the browser
// still goes back to the return target, where the originating step shows the
// error. Process itself returns an error only when the state cannot be
// consumed or the outcome cannot be stored: for both, the handler answers its
// uniform error page.
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

	// Before anything reaches a provider: a callback on another connection's
	// path carries that provider's answer, and exchanging its code at the
	// pinned connection would hand the code to the wrong token endpoint (the
	// mix-up attack, RFC 9700 §4.4). The check needs the consumed record,
	// which alone names the pinned connection, so the state is spent like on
	// every other failure after the consume.
	if in.ConnectionSlug != pending.ProviderSlug {
		return c.fail(ctx, projectID, check, fmt.Errorf("%w: the callback path names connection %q, the state pins %q", errSSOCallbackMixUp, in.ConnectionSlug, pending.ProviderSlug), refusedEventType(in))
	}

	if in.Error != "" {
		// access_denied is the person saying no and gets its own key. Every
		// other code is the provider failing.
		key := domain.FlowStepErrorSSOFailed
		if in.Error == oauthErrorAccessDenied {
			key = domain.FlowStepErrorSSOCancelled
		}
		// The description and URI are logged for the operator and never
		// stored: the user sees only the localized key.
		getLoggingContext(ctx, "flow").Warn("sso provider returned an error",
			slog.String("project_id", projectID),
			slog.String("slug", pending.ProviderSlug),
			slog.String("error", in.Error),
			slog.String("error_description", in.ErrorDescription),
			slog.String("error_uri", in.ErrorURI),
		)
		return c.park(ctx, projectID, check, key, domain.EventTypeAuthSSOAuthorizationFailed)
	}
	if in.Code == "" {
		return c.fail(ctx, projectID, check, errors.New("the callback carried neither a code nor an error"), domain.EventTypeAuthSSOAuthorizationFailed)
	}

	identity, err := c.exchange(ctx, projectID, in, pending)
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
	return FlowSSOCallbackOutput{ReturnTarget: pending.ReturnTarget}, nil
}

// exchange rebuilds the engine client from the revision and redirect URI the
// record pinned at submit and runs the token exchange.
func (c *FlowSSOCallback) exchange(ctx context.Context, projectID string, in FlowSSOCallbackInput, pending *domain.SSOStatePayload) (idp.ExternalIdentity, error) {
	connection, err := c.connections.GetRevision(ctx, projectID, pending.ConnectionRevisionID)
	if err != nil {
		return idp.ExternalIdentity{}, err
	}
	conn, err := idp.ParseConnection(connection.RevisionID, connection.Document)
	if err != nil {
		return idp.ExternalIdentity{}, err
	}
	// RFC 9207: an `iss` the provider sent names who issued the code. The
	// per-connection path rests on every provider matching redirect_uri
	// exactly; a provider registered with a wildcard could still answer on
	// another connection's path, and its own issuer gives it away. Most
	// providers send no `iss`, so only a present value is checked, as a simple
	// string comparison.
	if in.Issuer != "" && in.Issuer != conn.OIDC.Issuer {
		return idp.ExternalIdentity{}, fmt.Errorf("%w: the callback's iss %q is not the issuer %q of connection %q", errSSOCallbackMixUp, in.Issuer, conn.OIDC.Issuer, pending.ProviderSlug)
	}
	if err := resolveSSOClientID(ctx, c.variables, projectID, &conn); err != nil {
		return idp.ExternalIdentity{}, err
	}
	secret, err := c.resolveClientSecret(ctx, projectID, conn)
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
		Code:         in.Code,
		Nonce:        pending.OIDCNonce,
		PKCEVerifier: verifier,
		RedirectURI:  pending.RedirectURI,
		RevisionID:   pending.ConnectionRevisionID,
		ClientSecret: secret,
		// No strategy registry exists yet; a connection whose
		// verified_claims need one fails the ceremony (requireStrategy).
		SupplementaryFetch: nil,
	})
}

// resolveClientSecret reads the secret for the token exchange from the
// project's variables.
func (c *FlowSSOCallback) resolveClientSecret(ctx context.Context, projectID string, conn idp.Connection) (string, error) {
	name, ok := domain.VariableReferenceName(conn.OIDC.ClientSecretRef)
	if !ok {
		// The schema accepts only a whole-value `${{ NAME }}` reference. The
		// value is not echoed: it may be a pasted secret, and this error is
		// logged.
		return "", errors.New("client_secret is not a variable reference")
	}
	vars, err := c.variables.GetDecryptedVariables(ctx, domain.VariableOwner{ProjectID: projectID}, name)
	if err != nil {
		return "", err
	}
	secret := ""
	// A plain variable is refused: it is readable through the variables
	// surface, and refusing it makes the misconfiguration visible.
	if len(vars) == 1 && vars[0].IsSecret {
		secret, _ = vars[0].Value.(string)
	}
	if secret == "" {
		return "", fmt.Errorf("client_secret variable %q is missing, not a secret, or not a string", name)
	}
	return secret, nil
}

// fail logs the cause the user must not see and stores the generic failure
// key with eventType. An internal error is still stored, so the user can retry
// from the step: the state is already consumed, and the error page has no way
// back.
func (c *FlowSSOCallback) fail(ctx context.Context, projectID string, check *domain.SSOCallbackCheck, cause error, eventType domain.EventType) (FlowSSOCallbackOutput, error) {
	// A cancelled request is not the provider's fault, and the client is
	// gone, so nothing is logged. A deadline is still logged.
	if !errors.Is(ctx.Err(), context.Canceled) {
		// An internal error is a bug in this process, not a ceremony outcome.
		level := slog.LevelWarn
		if errors.Is(cause, domain.ErrInternal(nil)) {
			level = slog.LevelError
		}
		getLoggingContext(ctx, "flow").Log(ctx, level, "sso callback failed",
			slog.String("project_id", projectID),
			slog.String("slug", check.Pending.ProviderSlug),
			slog.Any("error", cause),
		)
	}
	return c.park(ctx, projectID, check, domain.FlowStepErrorSSOFailed, eventType)
}

// park stores an error result on the consumed record, emitting eventType, and
// sends the browser back to the return target, where the originating step
// shows the key.
func (c *FlowSSOCallback) park(ctx context.Context, projectID string, check *domain.SSOCallbackCheck, key string, eventType domain.EventType) (FlowSSOCallbackOutput, error) {
	result := &domain.SSOCallbackResult{ErrorKey: key}
	if err := c.attempts.SetSSOCallbackResult(ctx, projectID, check, result, eventType); err != nil {
		return FlowSSOCallbackOutput{}, err
	}
	return FlowSSOCallbackOutput{ReturnTarget: check.Pending.ReturnTarget}, nil
}
