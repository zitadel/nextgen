package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/idp"
)

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
// A provider or configuration failure is stored as a generic error key and
// logged, and the browser still goes back to the return target, where the
// originating step shows the error. Process itself returns an error only when
// the state cannot be consumed or this process failed: for both, the handler
// has no return target and answers its uniform error page.
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
	pending := check.Pending

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
		return c.park(ctx, projectID, in.State, pending, key)
	}
	if in.Code == "" {
		return c.fail(ctx, projectID, in.State, pending, errors.New("the callback carried neither a code nor an error"))
	}

	identity, err := c.exchange(ctx, projectID, in.Code, pending)
	if err != nil {
		return c.fail(ctx, projectID, in.State, pending, err)
	}
	result := &domain.SSOCallbackResult{
		Subject:              identity.Subject,
		ConnectionRevisionID: identity.RevisionID,
		ProviderSlug:         pending.ProviderSlug,
		Claims:               identity.Claims,
		Verified:             identity.Verified,
	}
	if err := c.attempts.SetSSOCallbackResult(ctx, projectID, in.State, result); err != nil {
		return FlowSSOCallbackOutput{}, err
	}
	return FlowSSOCallbackOutput{ReturnTarget: pending.ReturnTarget}, nil
}

// exchange rebuilds the engine client from the revision and redirect URI the
// record pinned at submit and runs the token exchange.
func (c *FlowSSOCallback) exchange(ctx context.Context, projectID, code string, pending *domain.SSOStatePayload) (idp.ExternalIdentity, error) {
	connection, err := c.connections.GetRevision(ctx, projectID, pending.ConnectionRevisionID)
	if err != nil {
		return idp.ExternalIdentity{}, err
	}
	conn, err := idp.ParseConnection(connection.RevisionID, connection.Document)
	if err != nil {
		return idp.ExternalIdentity{}, err
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
		Code:         code,
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
// key. An internal error is a bug in this process, not a ceremony outcome,
// and is returned instead.
func (c *FlowSSOCallback) fail(ctx context.Context, projectID, state string, pending *domain.SSOStatePayload, cause error) (FlowSSOCallbackOutput, error) {
	if errors.Is(cause, domain.ErrInternal(nil)) {
		return FlowSSOCallbackOutput{}, domain.ErrInternal(cause)
	}
	// A cancelled request is not the provider's fault, and the client is
	// gone, so no warning. A deadline is still logged.
	if !errors.Is(ctx.Err(), context.Canceled) {
		getLoggingContext(ctx, "flow").Warn("sso callback failed",
			slog.String("project_id", projectID),
			slog.String("slug", pending.ProviderSlug),
			slog.Any("error", cause),
		)
	}
	return c.park(ctx, projectID, state, pending, domain.FlowStepErrorSSOFailed)
}

// park stores an error result on the consumed record and sends the browser
// back to the return target, where the originating step shows the key.
func (c *FlowSSOCallback) park(ctx context.Context, projectID, state string, pending *domain.SSOStatePayload, key string) (FlowSSOCallbackOutput, error) {
	result := &domain.SSOCallbackResult{ProviderSlug: pending.ProviderSlug, ErrorKey: key}
	if err := c.attempts.SetSSOCallbackResult(ctx, projectID, state, result); err != nil {
		return FlowSSOCallbackOutput{}, err
	}
	return FlowSSOCallbackOutput{ReturnTarget: pending.ReturnTarget}, nil
}