//go:build sqlite_integration

package oauth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/oidc/v3/pkg/op"

	"github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/cache"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dbtest"
)

const (
	testSchemaBase = "https://example.com/api/schemas"
	testPublicBase = "https://zitadel.example.com"
	testUserID     = "user_developer"
	testRedirect   = "http://127.0.0.1:51234/callback"
)

// developers stands in for the user service: the grant records are real rows
// that need a real user, but what the user service reads is not under test.
type developers struct{}

func (developers) GetMyUser(_ context.Context, input service.GetMyUserInput) (*domain.User, error) {
	if input.Self.UserID() != testUserID {
		return nil, domain.ErrUserNotFound()
	}
	return &domain.User{ID: testUserID, ProjectID: input.Self.ProjectID()}, nil
}

// newTestServer is the authorization server over a real SQLite database: the
// platform project with its keys, one developer, and the grant records in
// the tokens table.
func newTestServer(t *testing.T) *Server {
	t.Helper()
	ctx := t.Context()
	dbPool, stop, err := dbtest.SQLite(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)
	pool := service.NewPool(dbPool)

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	masterKeys, err := domain.NewMasterKeys([]domain.MasterKey{domain.NewMasterKey("master-key", *key, true)})
	require.NoError(t, err)
	crypters, err := cache.NewMeteredLRU[service.CrypterCacheKey, op.Crypto](cache.NameCrypter, 64)
	require.NoError(t, err)
	signingKeys, err := cache.NewMeteredLRU[service.SigningKeyCacheKey, domain.SigningKey](cache.NameSigningKey, 64)
	require.NoError(t, err)
	keys := service.NewKeyService(pool, *masterKeys, crypters, signingKeys)
	validator, err := domain.NewSchemaValidator(testSchemaBase)
	require.NoError(t, err)
	hashers, err := (&crypto.HashConfig{
		Verifiers: []crypto.HashName{crypto.HashNameBcrypt},
		Hasher:    crypto.HasherConfig{Algorithm: crypto.HashNameBcrypt, Params: map[string]any{"cost": 10}},
		Limits:    crypto.HashLimitsConfig{Bcrypt: crypto.BcryptLimitsConfig{MinCost: 10, MaxCost: 16}},
	}).NewHasherFactory()
	require.NoError(t, err)
	projects := service.NewProjectService(pool, testSchemaBase, validator, keys, hashers, domain.DefaultSharedHosts)
	_, err = projects.CreateWithID(ctx, domain.PlatformProjectID, "Platform", []domain.Origin{}, true)
	require.NoError(t, err)

	email, err := domain.NewCreateAttribute("email", "dev@example.com", domain.AttributeUniquenessProject)
	require.NoError(t, err)
	require.NoError(t, pool.Statements().CreateUser(ctx, &domain.CreateUser{
		ProjectID:  domain.PlatformProjectID,
		SchemaURL:  schemas.DefaultHumanUserSchemaURL(testSchemaBase),
		ID:         testUserID,
		Attributes: []domain.CreateAttribute{*email},
	}))

	server, err := New(Deps{
		Config:     Config{Enabled: true, DynamicRegistration: true},
		PublicBase: testPublicBase,
		ProjectID:  domain.PlatformProjectID,
		Keys:       keys,
		Users:      developers{},
		Grants:     service.NewOAuthGrantService(pool),
	})
	require.NoError(t, err)
	return server
}

// postToken calls the token endpoint and decodes its answer.
func postToken(t *testing.T, s *Server, form url.Values) (int, map[string]any) {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/oauth/proj_platform/token", strings.NewReader(form.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	s.token(w, r)
	var body map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	return w.Code, body
}

// codeFor is what a signed-in developer's browser brings back to the CLI.
func codeFor(t *testing.T, s *Server, resource string) string {
	t.Helper()
	code, err := s.newCode(t.Context(), authorizationRequest{
		ClientID:      CLIClientID,
		RedirectURI:   testRedirect,
		CodeChallenge: rfcChallenge,
		Resource:      resource,
	}, testUserID)
	require.NoError(t, err)
	return code
}

func exchange(code, verifier string) url.Values {
	return url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"client_id":     {CLIClientID},
		"redirect_uri":  {testRedirect},
		"code_verifier": {verifier},
	}
}

func refresh(token string) url.Values {
	return url.Values{"grant_type": {"refresh_token"}, "refresh_token": {token}, "client_id": {CLIClientID}}
}

func TestAccessTokenAudience(t *testing.T) {
	s := newTestServer(t)
	platform, _ := s.app.api(PlatformAPISlug)
	mcp, _ := s.app.api(MCPAPISlug)

	token, _, err := s.mintAccessToken(t.Context(), testUserID, CLIClientID, platform, nil)
	require.NoError(t, err)

	t.Run("verifies for the API it names", func(t *testing.T) {
		got, err := s.VerifyPlatformAccessToken(t.Context(), token)
		require.NoError(t, err)
		assert.Equal(t, testUserID, got.Subject)
		assert.Equal(t, domain.PlatformProjectID, got.ProjectID)
		assert.Equal(t, CLIClientID, got.ClientID)
	})
	t.Run("is refused by another API", func(t *testing.T) {
		_, err := s.Verify(t.Context(), token, mcp.Identifier)
		assert.ErrorIs(t, err, domain.ErrInvalidToken())
	})
	t.Run("is refused once altered", func(t *testing.T) {
		parts := strings.Split(token, ".")
		parts[1] = parts[1][:len(parts[1])-2] + "AA"
		_, err := s.VerifyPlatformAccessToken(t.Context(), strings.Join(parts, "."))
		assert.ErrorIs(t, err, domain.ErrInvalidToken())
	})
	t.Run("a token the code exchange issues names the requested API", func(t *testing.T) {
		status, body := postToken(t, s, exchange(codeFor(t, s, mcp.Identifier), rfcVerifier))
		require.Equal(t, http.StatusOK, status, body)
		_, err := s.Verify(t.Context(), body["access_token"].(string), mcp.Identifier)
		assert.NoError(t, err)
		_, err = s.VerifyPlatformAccessToken(t.Context(), body["access_token"].(string))
		assert.ErrorIs(t, err, domain.ErrInvalidToken())
	})
}

func TestCodeExchange(t *testing.T) {
	s := newTestServer(t)
	platform, _ := s.app.api(PlatformAPISlug)

	t.Run("refuses a verifier that does not match the challenge", func(t *testing.T) {
		status, body := postToken(t, s, exchange(codeFor(t, s, platform.Identifier), "aBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, errInvalidGrant, body["error"])
	})
	t.Run("refuses another redirect URI than the request's", func(t *testing.T) {
		form := exchange(codeFor(t, s, platform.Identifier), rfcVerifier)
		form.Set("redirect_uri", "http://127.0.0.1:9999/callback")
		status, body := postToken(t, s, form)
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, errInvalidGrant, body["error"])
	})
	t.Run("redeems a code once, and a replay ends the grant", func(t *testing.T) {
		code := codeFor(t, s, platform.Identifier)
		status, first := postToken(t, s, exchange(code, rfcVerifier))
		require.Equal(t, http.StatusOK, status, first)

		status, replay := postToken(t, s, exchange(code, rfcVerifier))
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, errInvalidGrant, replay["error"])

		status, body := postToken(t, s, refresh(first["refresh_token"].(string)))
		assert.Equal(t, http.StatusBadRequest, status, "the replayed code's refresh token died with its grant")
		assert.Equal(t, errInvalidGrant, body["error"])
	})
}

func TestRefreshRotation(t *testing.T) {
	s := newTestServer(t)
	platform, _ := s.app.api(PlatformAPISlug)
	status, first := postToken(t, s, exchange(codeFor(t, s, platform.Identifier), rfcVerifier))
	require.Equal(t, http.StatusOK, status, first)
	rt1 := first["refresh_token"].(string)

	status, second := postToken(t, s, refresh(rt1))
	require.Equal(t, http.StatusOK, status, second)
	rt2 := second["refresh_token"].(string)
	assert.NotEqual(t, rt1, rt2, "every refresh rotates the refresh token")
	_, err := s.VerifyPlatformAccessToken(t.Context(), second["access_token"].(string))
	assert.NoError(t, err, "and returns a working access token")

	status, replay := postToken(t, s, refresh(rt1))
	assert.Equal(t, http.StatusBadRequest, status, "a rotated-out refresh token is refused")
	assert.Equal(t, errInvalidGrant, replay["error"])

	status, after := postToken(t, s, refresh(rt2))
	assert.Equal(t, http.StatusBadRequest, status, "the replay revoked the grant, the current token too (ADR 037)")
	assert.Equal(t, errInvalidGrant, after["error"])
}

func TestRefreshIsBoundToItsClient(t *testing.T) {
	s := newTestServer(t)
	platform, _ := s.app.api(PlatformAPISlug)
	status, first := postToken(t, s, exchange(codeFor(t, s, platform.Identifier), rfcVerifier))
	require.Equal(t, http.StatusOK, status, first)

	form := refresh(first["refresh_token"].(string))
	form.Set("client_id", "https://other-client.example/metadata.json")
	status, body := postToken(t, s, form)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, errInvalidGrant, body["error"])
}
