package helpers

import (
	"context"
	"net/http"
	"testing"

	"github.com/ogen-go/ogen/ogenerrors"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	internalapi "github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/domain"
)

type FakeSecuritySource struct {
	Token  string
	Scopes []string

	SessionToken string
	// OmitCSRF stops the client sending X-Zitadel-CSRF with the session
	// cookie, for tests of the server refusing a write without it.
	OmitCSRF bool
}

func (f FakeSecuritySource) OAuth2(ctx context.Context, operationName api.OperationName) (api.OAuth2, error) {
	// Skip empty oauth2 only when a session cookie is set; both empty still
	// sends Bearer so oauth2-only 401 tests reach the server.
	if f.Token == "" && f.SessionToken != "" {
		return api.OAuth2{}, ogenerrors.ErrSkipClientSecurity
	}
	return api.OAuth2{
		Token:  f.Token,
		Scopes: f.Scopes,
	}, nil
}

// NextgenSession provides the __nextgen_session cookie. With an empty
// SessionToken the scheme is skipped and the generated client fails fast with
// "security requirement is not satisfied" instead of sending the request —
// to exercise the server's missing-credential path, send a raw HTTP request
// (see TestGetMyUser/missing_session_cookie).
func (f FakeSecuritySource) NextgenSession(ctx context.Context, operationName api.OperationName) (api.NextgenSession, error) {
	if f.SessionToken == "" {
		return api.NextgenSession{}, ogenerrors.ErrSkipClientSecurity
	}
	return api.NextgenSession{
		APIKey: f.SessionToken,
	}, nil
}

var _ api.SecuritySource = (*FakeSecuritySource)(nil)

type ApiClient struct {
	*api.Client
	securitySource *FakeSecuritySource
}

func NewApiClient(
	serverURL string,
) (*ApiClient, error) {
	securitySource := &FakeSecuritySource{}
	client, err := api.NewClient(serverURL, securitySource,
		//egress:allow integration-test client talking to the server under test
		api.WithClient(&http.Client{Transport: csrfTransport{source: securitySource}}))
	if err != nil {
		return nil, err
	}
	return &ApiClient{
		Client:         client,
		securitySource: securitySource,
	}, nil
}

func (c *ApiClient) SetToken(token string) {
	c.securitySource.Token = token
}
func (c *ApiClient) Token() string {
	return c.securitySource.Token
}
func (c *ApiClient) SetScopes(scopes []string) {
	c.securitySource.Scopes = scopes
}
func (c *ApiClient) SetSessionToken(token string) {
	c.securitySource.SessionToken = token
}

// SetOmitCSRF makes session-cookie writes go out without X-Zitadel-CSRF.
func (c *ApiClient) SetOmitCSRF(omit bool) {
	c.securitySource.OmitCSRF = omit
}

// csrfTransport sends the session's X-Zitadel-CSRF token on unsafe requests,
// as the Console does (ADR 053 §5), so session tests exercise the same
// contract as the browser. Only when the request actually carries the session
// cookie: a Bearer caller needs no token.
type csrfTransport struct {
	source *FakeSecuritySource
}

func (c csrfTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	switch req.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
	default:
		if cookie, err := req.Cookie("__nextgen_session"); err == nil && !c.source.OmitCSRF &&
			req.Header.Get(internalapi.CSRFHeader) == "" {
			req = req.Clone(req.Context())
			req.Header.Set(internalapi.CSRFHeader, internalapi.CSRFToken(cookie.Value))
		}
	}
	//egress:allow integration-test client talking to the server under test
	return http.DefaultTransport.RoundTrip(req)
}

// ProjectSecret mints the project's bearer, for tests that send a raw request
// instead of going through the generated client.
func (h *Harness) ProjectSecret(t *testing.T, project *domain.Project) string {
	t.Helper()

	secret, err := h.EnsureTokenService(t).GenerateJWE(t.Context(), project.Token())
	require.NoError(t, err)

	return secret
}

func (h *Harness) SetProjectSecretOnApiClient(t *testing.T, client *ApiClient, project *domain.Project) {
	t.Helper()

	client.SetToken(h.ProjectSecret(t, project))
}

// SetScopedTokenOnApiClient mints a bearer with exactly the given scopes.
// Production only mints project and preview secrets, so this is the only way
// for a test to hold a finer scope like session.read until ADR 036's
// credential planes mint such tokens for real.
func (h *Harness) SetScopedTokenOnApiClient(t *testing.T, client *ApiClient, project *domain.Project, scopes ...string) {
	t.Helper()

	tok := project.Token()
	tok.Scope = scopes
	secret, err := h.EnsureTokenService(t).GenerateJWE(t.Context(), tok)
	require.NoError(t, err)

	client.SetToken(secret)
}

func (h *Harness) SetPreviewSecretOnApiClient(t *testing.T, client *ApiClient, project *domain.Project) {
	t.Helper()

	token := project.PreviewToken()
	secret, err := h.EnsureTokenService(t).GenerateJWE(t.Context(), token)
	require.NoError(t, err)

	client.SetToken(secret)
}
