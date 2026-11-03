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
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
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

// developers stands in for the user service: the consents are real rows
// that need a real user, but what the user service reads is not under test.
type developers struct{}

func (developers) GetMyUser(_ context.Context, input service.GetMyUserInput) (*domain.User, error) {
	if input.Self.UserID() != testUserID {
		return nil, domain.ErrUserNotFound()
	}
	return &domain.User{ID: testUserID, ProjectID: input.Self.ProjectID()}, nil
}

// newTestServer is the authorization server over a real SQLite database: the
// platform project with its keys, one developer, and the consents and the
// records of the tokens issued under them.
func newTestServer(t *testing.T, configure ...func(*Deps)) *Server {
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

	deps := Deps{
		Config:     Config{Enabled: true, DynamicRegistration: true},
		PublicBase: testPublicBase,
		ProjectID:  domain.PlatformProjectID,
		Keys:       keys,
		Users:      developers{},
	}
	for _, c := range configure {
		c(&deps)
	}
	if deps.Consents == nil {
		deps.Consents = service.NewConsentService(pool, deps.Config.ConsentLifetimes())
	}
	server, err := New(deps)
	require.NoError(t, err)
	return server
}

// postToken calls the token endpoint and decodes its answer.
func postToken(t *testing.T, s *Server, form url.Values) (int, map[string]any) {
	t.Helper()
	w := post(s, "/token", form)
	var body map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body), w.Body.String())
	return w.Code, body
}

// codeFor is what a signed-in developer's browser brings back to the CLI: a
// code issued under the developer's consent to the CLI.
func codeFor(t *testing.T, s *Server, resource string) string {
	t.Helper()
	consent, err := s.consents.Give(t.Context(), service.GiveConsentInput{
		ProjectID: s.projectID,
		UserID:    testUserID,
		ClientID:  CLIClientID,
		Resource:  resource,
	})
	require.NoError(t, err)
	code, err := s.newCode(t.Context(), authorizationRequest{
		ClientID:      CLIClientID,
		RedirectURI:   testRedirect,
		CodeChallenge: rfcChallenge,
		Resource:      resource,
	}, testUserID, consent.ID)
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
	t.Run("redeems a code once, and a replay ends its consent's tokens", func(t *testing.T) {
		code := codeFor(t, s, platform.Identifier)
		status, first := postToken(t, s, exchange(code, rfcVerifier))
		require.Equal(t, http.StatusOK, status, first)

		status, replay := postToken(t, s, exchange(code, rfcVerifier))
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, errInvalidGrant, replay["error"])

		status, body := postToken(t, s, refresh(first["refresh_token"].(string)))
		assert.Equal(t, http.StatusBadRequest, status, "the replayed code's refresh token died with its consent's tokens")
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
	assert.Equal(t, http.StatusBadRequest, status, "the replay revoked every token of the consent, the current one too (ADR 037)")
	assert.Equal(t, errInvalidGrant, after["error"])
}

func TestRefreshIsBoundToItsClient(t *testing.T) {
	s := newTestServer(t)
	platform, _ := s.app.api(PlatformAPISlug)
	status, first := postToken(t, s, exchange(codeFor(t, s, platform.Identifier), rfcVerifier))
	require.Equal(t, http.StatusOK, status, first)
	other, err := s.seal(t.Context(), kindClient, registration{ClientName: "Other", RedirectURIs: []string{testRedirect}}, 0)
	require.NoError(t, err)

	form := refresh(first["refresh_token"].(string))
	form.Set("client_id", other)
	status, body := postToken(t, s, form)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, errInvalidGrant, body["error"])
}

func TestRevocationEndsTheToken(t *testing.T) {
	s := newTestServer(t)
	platform, _ := s.app.api(PlatformAPISlug)
	status, first := postToken(t, s, exchange(codeFor(t, s, platform.Identifier), rfcVerifier))
	require.Equal(t, http.StatusOK, status, first)
	rt := first["refresh_token"].(string)

	w := post(s, "/revoke", url.Values{"token": {rt}, "client_id": {CLIClientID}})
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	status, body := postToken(t, s, refresh(rt))
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, errInvalidGrant, body["error"])
}

func TestKeysVerifyTheAccessTokens(t *testing.T) {
	s := newTestServer(t)
	platform, _ := s.app.api(PlatformAPISlug)
	status, first := postToken(t, s, exchange(codeFor(t, s, platform.Identifier), rfcVerifier))
	require.Equal(t, http.StatusOK, status, first)

	w := serve(s, httptest.NewRequest(http.MethodGet, s.namespace()+"/jwks", nil))
	require.Equal(t, http.StatusOK, w.Code)
	var set jose.JSONWebKeySet
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &set))
	token, err := jose.ParseSigned(first["access_token"].(string), []jose.SignatureAlgorithm{jose.EdDSA})
	require.NoError(t, err)
	keys := set.Key(token.Signatures[0].Header.KeyID)
	require.Len(t, keys, 1, "the token's key is published")
	_, err = token.Verify(keys[0])
	assert.NoError(t, err)
}

// Revoking a consent, as the user does among the apps they connected, ends
// every token issued under it (ADR 082 §8).
func TestRevokingAConsentEndsItsTokens(t *testing.T) {
	s := newTestServer(t)
	platform, _ := s.app.api(PlatformAPISlug)
	status, first := postToken(t, s, exchange(codeFor(t, s, platform.Identifier), rfcVerifier))
	require.Equal(t, http.StatusOK, status, first)
	consent, err := s.consents.Find(t.Context(), s.projectID, testUserID, CLIClientID, platform.Identifier)
	require.NoError(t, err)

	require.NoError(t, s.consents.Revoke(t.Context(), s.projectID, testUserID, consent.ID))

	status, body := postToken(t, s, refresh(first["refresh_token"].(string)))
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, errInvalidGrant, body["error"])
}

// Signing out on one machine revokes that machine's refresh token (RFC 7009);
// another sign-in under the same consent keeps working.
func TestRevokingOneTokenKeepsTheOtherSignIns(t *testing.T) {
	s := newTestServer(t)
	platform, _ := s.app.api(PlatformAPISlug)
	status, laptop := postToken(t, s, exchange(codeFor(t, s, platform.Identifier), rfcVerifier))
	require.Equal(t, http.StatusOK, status, laptop)
	status, desktop := postToken(t, s, exchange(codeFor(t, s, platform.Identifier), rfcVerifier))
	require.Equal(t, http.StatusOK, status, desktop)

	w := post(s, "/revoke", url.Values{"token": {laptop["refresh_token"].(string)}, "client_id": {CLIClientID}})
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	status, body := postToken(t, s, refresh(desktop["refresh_token"].(string)))
	assert.Equal(t, http.StatusOK, status, body)
}

// signedIn stands in for the token service: the cookie it knows is the
// developer's session.
type signedIn struct{}

const testSessionCookie = "session-cookie"

func (signedIn) IntrospectToken(_ context.Context, token string) (*domain.Token, error) {
	if token != testSessionCookie {
		return nil, domain.ErrInvalidToken()
	}
	sessionID := "sess_developer"
	return &domain.Token{
		ProjectID: domain.PlatformProjectID,
		UserID:    testUserID,
		Type:      domain.TokenTypeSessionToken,
		SessionID: &sessionID,
	}, nil
}

var (
	consentRequestField = regexp.MustCompile(`name="request" value="([^"]+)"`)
	consentCSRFField    = regexp.MustCompile(`name="csrf" value="([^"]+)"`)
)

// A third-party client is asked for consent once: an authorization asking
// for nothing more goes straight to a code, until it asks for a scope the
// user did not agree to or says prompt=consent (ADR 082 §8).
func TestAThirdPartyIsAskedForConsentOnce(t *testing.T) {
	var documentURL string
	documents := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"client_id":     documentURL,
			"client_name":   "Agent",
			"redirect_uris": []string{testRedirect},
		})
	}))
	t.Cleanup(documents.Close)
	documentURL = documents.URL + "/metadata.json"
	s := newTestServer(t, func(d *Deps) {
		d.Config.ClientIDMetadataDocuments = true
		d.Sessions = signedIn{}
		d.Fetch = documents.Client()
	})
	mcp, _ := s.app.api(MCPAPISlug)
	authorize := func(scope string, extra ...string) *httptest.ResponseRecorder {
		q := url.Values{
			"client_id":             {documentURL},
			"response_type":         {"code"},
			"redirect_uri":          {testRedirect},
			"code_challenge":        {rfcChallenge},
			"code_challenge_method": {"S256"},
			"resource":              {mcp.Identifier},
			"scope":                 {scope},
		}
		for i := 0; i < len(extra); i += 2 {
			q.Set(extra[i], extra[i+1])
		}
		r := httptest.NewRequest(http.MethodGet, s.namespace()+"/authorize?"+q.Encode(), nil)
		r.AddCookie(&http.Cookie{Name: sessionCookieName, Value: testSessionCookie})
		return serve(s, r)
	}
	isConsentStep := func(w *httptest.ResponseRecorder) bool {
		return w.Code == http.StatusOK && consentRequestField.MatchString(w.Body.String())
	}
	isCode := func(w *httptest.ResponseRecorder) bool {
		location, err := url.Parse(w.Header().Get("Location"))
		return w.Code == http.StatusSeeOther && err == nil && location.Query().Get("code") != ""
	}

	first := authorize("openid")
	require.True(t, isConsentStep(first), "a first authorization asks: %d %s", first.Code, first.Header().Get("Location"))
	form := url.Values{
		"request":  {consentRequestField.FindStringSubmatch(first.Body.String())[1]},
		"csrf":     {consentCSRFField.FindStringSubmatch(first.Body.String())[1]},
		"decision": {"allow"},
	}
	allow := httptest.NewRequest(http.MethodPost, s.namespace()+"/consent", strings.NewReader(form.Encode()))
	allow.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	allow.AddCookie(&http.Cookie{Name: sessionCookieName, Value: testSessionCookie})
	allowed := serve(s, allow)
	require.True(t, isCode(allowed), "allowing issues a code: %d %s", allowed.Code, allowed.Body.String())

	assert.True(t, isCode(authorize("openid")), "the same scopes need no consent again")
	assert.True(t, isConsentStep(authorize("openid offline_access")), "a scope the user did not agree to asks again")
	assert.True(t, isConsentStep(authorize("openid", "prompt", "consent")), "prompt=consent asks again")
}

// Consenting again to more scopes widens the consent the user has, and the
// user's consents list newest first, one per client and API.
func TestConsentingAgainWidensTheConsent(t *testing.T) {
	s := newTestServer(t)
	platform, _ := s.app.api(PlatformAPISlug)
	mcp, _ := s.app.api(MCPAPISlug)
	give := func(resource string, scope ...string) *domain.Consent {
		t.Helper()
		consent, err := s.consents.Give(t.Context(), service.GiveConsentInput{
			ProjectID: s.projectID,
			UserID:    testUserID,
			ClientID:  CLIClientID,
			Resource:  resource,
			Scope:     scope,
		})
		require.NoError(t, err)
		return consent
	}

	first := give(platform.Identifier, "openid")
	again := give(platform.Identifier, "offline_access", "openid")
	assert.Equal(t, first.ID, again.ID, "one consent per client and API")
	assert.Equal(t, []string{"openid", "offline_access"}, again.Scope)
	give(mcp.Identifier, "openid")

	consents, _, err := s.consents.List(t.Context(), service.ListConsentsInput{ProjectID: s.projectID, UserID: testUserID})
	require.NoError(t, err)
	require.Len(t, consents, 2)
	assert.Equal(t, mcp.Identifier, consents[0].Resource, "newest first")

	err = s.consents.Revoke(t.Context(), s.projectID, "user_someone_else", consents[0].ID)
	assert.ErrorIs(t, err, domain.ErrConsentNotFound(), "a user revokes only their own consents")
}

// A consent's lifetime bounds every refresh under it: past it the refresh is
// refused, and the consent is gone.
func TestAConsentEndsWithItsLifetime(t *testing.T) {
	s := newTestServer(t, func(d *Deps) { d.Config.ConsentLifetime = time.Nanosecond })
	platform, _ := s.app.api(PlatformAPISlug)
	status, first := postToken(t, s, exchange(codeFor(t, s, platform.Identifier), rfcVerifier))
	require.Equal(t, http.StatusOK, status, first)

	status, body := postToken(t, s, refresh(first["refresh_token"].(string)))
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, errInvalidGrant, body["error"])
	_, err := s.consents.Find(t.Context(), s.projectID, testUserID, CLIClientID, platform.Identifier)
	assert.ErrorIs(t, err, domain.ErrConsentNotFound())
}
