package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/zitadel/zitadel/v5/internal/crypto"
	"github.com/zitadel/zitadel/v5/internal/domain"
	"github.com/zitadel/zitadel/v5/internal/idp"
)

// FlowSSORedirectIssuer implements [domain.FlowSSORedirectIssuer] over the
// connection service, the IdP engine and the auth-attempt service. The
// client is built before the state record is issued, so a provider that
// cannot be reached leaves no record behind.
type FlowSSORedirectIssuer struct {
	connections IDPConnectionService
	attempts    AuthAttemptService
	keys        KeyService
	variables   VariableService
	// httpClient is the hardened egress client; discovery fetches a
	// tenant-authored URL (ADR 061).
	httpClient *http.Client
}

func NewFlowSSORedirectIssuer(connections IDPConnectionService, attempts AuthAttemptService, keys KeyService, variables VariableService, httpClient *http.Client) *FlowSSORedirectIssuer {
	return &FlowSSORedirectIssuer{connections: connections, attempts: attempts, keys: keys, variables: variables, httpClient: httpClient}
}

var _ domain.FlowSSORedirectIssuer = (*FlowSSORedirectIssuer)(nil)

func (i *FlowSSORedirectIssuer) Issue(ctx context.Context, in domain.FlowIssueSSORedirectInput) (domain.FlowSSORedirectOutput, error) {
	connections, err := i.connections.GetBySlugs(ctx, in.ProjectID, []string{in.ProviderSlug})
	if err != nil {
		return domain.FlowSSORedirectOutput{}, domain.ErrInternal(err).WithMessage("failed to read identity provider connection")
	}
	if len(connections) == 0 {
		return domain.FlowSSORedirectOutput{}, domain.ErrIDPConnectionNotFound()
	}
	connection := connections[0]
	// The engine's rejections stay out of err: the error analysis unions
	// every assignment to a variable, so a later `return err` would put the
	// engine's codes on the submit endpoint, where unavailable hides them.
	conn, parseErr := idp.ParseConnection(connection.RevisionID, connection.Document)
	if parseErr != nil {
		return domain.FlowSSORedirectOutput{}, i.unavailable(ctx, in, parseErr)
	}
	// The client secret is not read here: the authorize request does not
	// use it.
	if resolveErr := resolveSSOClientID(ctx, i.variables, in.ProjectID, &conn); resolveErr != nil {
		return domain.FlowSSORedirectOutput{}, i.unavailable(ctx, in, resolveErr)
	}
	client, clientErr := idp.NewOIDCClient(ctx, conn, in.RedirectURI, i.httpClient)
	if clientErr != nil {
		return domain.FlowSSORedirectOutput{}, i.unavailable(ctx, in, clientErr)
	}
	var encrypter crypto.Encrypter
	if conn.OIDC.PKCEEnabled {
		crypter, err := i.keys.GetProjectCrypter(ctx, in.ProjectID, domain.EncryptionKeyPurposeSecret)
		if err != nil {
			return domain.FlowSSORedirectOutput{}, err
		}
		encrypter = crypter
	}
	state, err := i.attempts.IssueSSOState(ctx, IssueSSOStateInput{
		ProjectID:            in.ProjectID,
		AttemptID:            in.AttemptID,
		ProviderSlug:         in.ProviderSlug,
		ConnectionRevisionID: connection.RevisionID,
		RedirectURI:          in.RedirectURI,
		ReturnTarget:         in.ReturnTarget,
		PKCEEncrypter:        encrypter,
	})
	if err != nil {
		return domain.FlowSSORedirectOutput{}, err
	}
	redirect, err := idp.NewAuthorizeRedirect(client, idp.AuthorizeRequest{
		State:        state.State,
		Nonce:        state.OIDCNonce,
		PKCEVerifier: state.PKCEVerifier,
	})
	if err != nil {
		return domain.FlowSSORedirectOutput{}, err
	}
	return domain.FlowSSORedirectOutput{RedirectURL: redirect.URL, BindingNonce: state.BindingNonce}, nil
}

// resolveSSOClientID fills a `${{ NAME }}` client_id on conn from the
// project's variables (ADR 062). A literal client_id is left as it is. A
// variable marked secret is refused rather than decrypted: the value goes
// into a URL the browser sees. The redirect issuer and the callback both
// resolve through this, so both read the client_id the same way; a variable
// changed in between fails the exchange, as a changed secret would.
func resolveSSOClientID(ctx context.Context, variables VariableService, projectID string, conn *idp.Connection) error {
	name, ok := domain.VariableReferenceName(conn.OIDC.ClientID)
	if !ok {
		return nil
	}
	vars, err := variables.GetVariables(ctx, domain.VariableOwner{ProjectID: projectID}, name)
	if err != nil {
		return err
	}
	clientID := ""
	if len(vars) == 1 && !vars[0].IsSecret {
		clientID, _ = vars[0].Value.(string)
	}
	if clientID == "" {
		return fmt.Errorf("client_id variable %q is missing, a secret, or not a string", name)
	}
	conn.OIDC.ClientID = clientID
	return nil
}

// unavailable turns an engine rejection of the connection into the step
// error the user can act on, and logs the cause the user must not see. An
// internal error is a bug in this process, not the provider, and stays
// internal; it is wrapped rather than passed so the error analysis does not
// put the engine's codes on the submit endpoint.
func (i *FlowSSORedirectIssuer) unavailable(ctx context.Context, in domain.FlowIssueSSORedirectInput, err error) error {
	if errors.Is(err, domain.ErrInternal(nil)) {
		return domain.ErrInternal(err)
	}
	// A cancelled request fails the discovery fetch too; that is not the
	// provider's fault, and the client is gone, so no warning. A deadline is
	// still logged.
	if !errors.Is(ctx.Err(), context.Canceled) {
		getLoggingContext(ctx, "flow").Warn("sso provider unavailable",
			slog.String("project_id", in.ProjectID),
			slog.String("slug", in.ProviderSlug),
			slog.Any("error", err),
		)
	}
	return domain.ErrFlowSSOUnavailable(err)
}
