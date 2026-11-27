package oauth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/zitadel/oidc/v3/pkg/oidc"
	"github.com/zitadel/oidc/v3/pkg/op"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// maxClientIDLength is the maxLength of client_id in application.json.
const maxClientIDLength = 255

// maxDeploymentIDLength is above the longest deployment ID: `dep_` and a
// UUID, 40 characters.
const maxDeploymentIDLength = 64

// VerifyClient authenticates the client of a token request with its client
// secret, sent with HTTP Basic or in the form (RFC 6749 §2.3.1). The request
// comes from the client's backend, not through the SDK proxy, so it carries no
// forwarded headers and the project comes from the path alone.
func (s opServer) VerifyClient(ctx context.Context, r *op.Request[op.ClientCredentials]) (_ op.Client, err error) {
	// The library authenticates the client of every endpoint it serves with
	// one; the others are not served yet and answer as before.
	if !strings.HasSuffix(r.URL.Path, TokenPath) {
		return s.UnimplementedServer.VerifyClient(ctx, r)
	}
	defer func() { keepError(ctx, err) }()
	// RFC 6749 §3.2: a GET would carry the client secret in the URL.
	if r.Method != http.MethodPost {
		return nil, op.NewStatusError(oidc.ErrInvalidRequest().WithDescription("the method must be POST"), http.StatusBadRequest)
	}
	// The library reads the query too, and RFC 6749 §2.3.1 keeps the
	// credentials out of the URL.
	if r.URL.RawQuery != "" {
		return nil, op.NewStatusError(oidc.ErrInvalidRequest().WithDescription("parameters must be in the request body"), http.StatusBadRequest)
	}
	if err := repeatedParameter(r.Form); err != nil {
		return nil, err
	}
	// An unknown project gets the answer of an unknown client, so the
	// endpoint tells neither which projects nor which clients exist. The
	// cause stays in the log only.
	refused := func(cause error) error {
		return op.NewStatusError(oidc.ErrInvalidClient().WithDescription("client authentication failed").WithParent(cause), http.StatusUnauthorized)
	}
	projectID, _, err := tenantProject(op.TenantFromContext(ctx), s.platformEnabled)
	if err != nil {
		return nil, refused(err)
	}
	if r.Data.ClientAssertion != "" || r.Data.ClientAssertionType != "" {
		return nil, op.NewStatusError(oidc.ErrInvalidClient().WithDescription("client assertions are not supported"), http.StatusUnauthorized)
	}
	// A lookup with text a dialect cannot hold fails as a 500, and the code's
	// refusal event would store the client ID. No client holds an ID longer
	// than application.json allows.
	if !storable(r.Data.ClientID) || len(r.Data.ClientID) > maxClientIDLength {
		return nil, refused(nil)
	}
	// The code names the deployment that served its authorization request
	// (domain.NewAuthCode). A declared client's secret is a variable of that
	// deployment; a registered client ignores it. Text no dialect stores, or
	// longer than any deployment ID, names none.
	deploymentID := domain.AuthCodeDeploymentID(r.Form.Get("code"))
	// Every grant comes here: a stray code on another grant must not choose
	// the deployment.
	if r.Form.Get("grant_type") != string(oidc.GrantTypeCode) ||
		!storable(deploymentID) || len(deploymentID) > maxDeploymentIDLength {
		deploymentID = ""
	}
	// A public client authenticates with client_id only (AuthMethodNone) and
	// PKCE on the code. A confidential client must send its secret.
	doc, err := s.tokenClientDocument(ctx, projectID, deploymentID, r.Data.ClientID, r.Data.ClientSecret, refused)
	if err != nil {
		return nil, err
	}
	c := newClient(r.Data.ClientID, doc)
	c.projectID = projectID
	return c, nil
}

// tokenClientDocument resolves the client of a token request once. An empty
// secret is allowed only for public clients; otherwise AuthenticateClient
// checks the secret. Lookup and deployment refusals share one error map.
func (s opServer) tokenClientDocument(
	ctx context.Context,
	projectID, deploymentID, clientID, secret string,
	refused func(error) error,
) (domain.ApplicationClientDocument, error) {
	mapErr := func(err error) error {
		switch {
		case errors.Is(err, domain.ErrApplicationClientNotFound()),
			errors.Is(err, domain.ErrApplicationNotFound()),
			errors.Is(err, domain.ErrApplicationClientSecretInvalid()):
			return refused(err)
		case errors.Is(err, domain.ErrReleaseNotDeployed(nil)),
			errors.Is(err, domain.ErrDeploymentNotFound()),
			errors.Is(err, domain.ErrReleaseRevoked()):
			return refused(err)
		case errors.Is(err, domain.ErrUnavailable()):
			return op.NewStatusError((&oidc.Error{ErrorType: temporarilyUnavailable}).WithParent(err), http.StatusServiceUnavailable)
		case err != nil:
			return op.NewStatusError(oidc.ErrServerError().WithParent(err), http.StatusInternalServerError)
		}
		return nil
	}
	if secret == "" {
		doc, err := s.clients.Client(ctx, projectID, deploymentID, clientID)
		if mapped := mapErr(err); mapped != nil {
			return domain.ApplicationClientDocument{}, mapped
		}
		if !doc.IsPublic() {
			return domain.ApplicationClientDocument{}, op.NewStatusError(
				oidc.ErrInvalidClient().WithDescription("the client must authenticate with its client secret"),
				http.StatusUnauthorized,
			)
		}
		return doc, nil
	}
	served, err := s.clients.AuthenticateClient(ctx, projectID, deploymentID, clientID, secret)
	if mapped := mapErr(err); mapped != nil {
		return domain.ApplicationClientDocument{}, mapped
	}
	return served.Document, nil
}

// CodeExchange redeems an authorization code for an access token. The library
// has already checked that the client may use the grant.
func (s opServer) CodeExchange(ctx context.Context, r *op.ClientRequest[oidc.AccessTokenRequest]) (_ *op.Response, err error) {
	defer func() { keepError(ctx, err) }()
	c := r.Client.(*client)
	token, expiresIn, err := s.authRequests.RedeemCode(ctx, service.RedeemCodeInput{
		ProjectID:    c.projectID,
		ClientID:     c.id,
		Code:         r.Data.Code,
		RedirectURI:  r.Data.RedirectURI,
		CodeVerifier: r.Data.CodeVerifier,
	})
	if err != nil {
		return nil, codeError(err)
	}
	response := op.NewResponse(&oidc.AccessTokenResponse{
		AccessToken: token,
		TokenType:   oidc.BearerToken,
		// Whole seconds, rounded down, so a client never holds the token
		// longer than its session.
		ExpiresIn: uint64(expiresIn / time.Second),
	})
	// RFC 6749 section 5.1; Cache-Control: no-store is set for every OAuth
	// route (httputil.WithForwardedNoStore).
	response.Header.Set("Pragma", "no-cache")
	return response, nil
}

// codeError is the answer to a redemption that failed with err. A refusal is
// invalid_grant, described only for what the client sent itself; anything
// else is a server fault.
func codeError(err error) error {
	switch {
	case errors.Is(err, domain.ErrAuthCodeRedirectURIMismatch()):
		return oidc.ErrInvalidGrant().WithDescription("redirect_uri does not match the authorization request").WithParent(err)
	case errors.Is(err, domain.ErrAuthCodeVerifierMissing()):
		return oidc.ErrInvalidGrant().WithDescription("code_verifier is required").WithParent(err)
	case errors.Is(err, domain.ErrAuthCodeVerifierInvalid()):
		return oidc.ErrInvalidGrant().WithDescription("code_verifier does not match the code_challenge").WithParent(err)
	case errors.Is(err, domain.ErrAuthCodeVerifierUnexpected()):
		return oidc.ErrInvalidGrant().WithDescription("code_verifier was sent, but the authorization request had no code_challenge").WithParent(err)
	case errors.Is(err, domain.ErrAuthCodeInvalid()):
		return oidc.ErrInvalidGrant().WithDescription("the code is invalid, expired or already used").WithParent(err)
	case errors.Is(err, domain.ErrUnavailable()):
		return op.NewStatusError((&oidc.Error{ErrorType: temporarilyUnavailable}).WithParent(err), http.StatusServiceUnavailable)
	}
	return oidc.ErrServerError().WithParent(err)
}

// repeatedParameter refuses a request that sends a parameter twice (RFC 6749
// §3.1 and §3.2): this server and a filter in front of it may each read
// another value.
func repeatedParameter(form url.Values) error {
	for name, values := range form {
		if len(values) > 1 {
			return op.NewStatusError(oidc.ErrInvalidRequest().WithDescription("a parameter is repeated").WithParent(fmt.Errorf("the parameter %.100q is repeated", name)), http.StatusBadRequest)
		}
	}
	return nil
}
