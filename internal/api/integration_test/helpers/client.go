package helpers

import (
	"context"
	"testing"

	"github.com/ogen-go/ogen/ogenerrors"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

type FakeSecuritySource struct {
	Token  string
	Scopes []string

	SessionToken string
}

func (f FakeSecuritySource) OAuth2(ctx context.Context, operationName api.OperationName) (api.OAuth2, error) {
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
	client, err := api.NewClient(serverURL, securitySource)
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

	tokenCrypter, err := h.EnsureKeyService(t).GetProjectCrypter(t.Context(), project.ID, domain.EncryptionKeyPurposeToken)
	require.NoError(t, err)
	token, err := (&domain.Token{ProjectID: project.ID, Scope: scopes}).JWE(tokenCrypter)
	require.NoError(t, err)

	client.SetToken(token)
}

func (h *Harness) SetPreviewSecretOnApiClient(t *testing.T, client *ApiClient, project *domain.Project) {
	t.Helper()

	token := project.PreviewToken()
	secret, err := h.EnsureTokenService(t).GenerateJWE(t.Context(), token)
	require.NoError(t, err)

	client.SetToken(secret)
}
