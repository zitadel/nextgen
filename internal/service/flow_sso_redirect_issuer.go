package service

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/idp"
)

// FlowSSORedirectIssuer implements [domain.FlowSSORedirectIssuer] over the
// connection service, the IdP engine and the auth-attempt service. The
// client is built before the state record is issued, so a provider that
// cannot be reached leaves no record behind.
type FlowSSORedirectIssuer struct {
	connections IDPConnectionService
	attempts    AuthAttemptService
	keys        KeyService
	// httpClient is the hardened egress client; discovery fetches a
	// tenant-authored URL (ADR 061).
	httpClient *http.Client
}

func NewFlowSSORedirectIssuer(connections IDPConnectionService, attempts AuthAttemptService, keys KeyService, httpClient *http.Client) *FlowSSORedirectIssuer {
	return &FlowSSORedirectIssuer{connections: connections, attempts: attempts, keys: keys, httpClient: httpClient}
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

// unavailable turns an engine rejection of the connection into the step
// error the user can act on, and logs the cause the user must not see. An
// internal error is a bug in this process, not the provider, and stays
// internal; it is wrapped rather than passed so the error analysis does not
// put the engine's codes on the submit endpoint.
func (i *FlowSSORedirectIssuer) unavailable(ctx context.Context, in domain.FlowIssueSSORedirectInput, err error) error {
	if errors.Is(err, domain.ErrInternal(nil)) {
		return domain.ErrInternal(err)
	}
	getLoggingContext(ctx, "flow").Warn("sso provider unavailable",
		slog.String("project_id", in.ProjectID),
		slog.String("slug", in.ProviderSlug),
		slog.Any("error", err),
	)
	return domain.ErrFlowSSOUnavailable(err)
}
