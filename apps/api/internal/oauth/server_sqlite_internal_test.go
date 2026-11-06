//go:build sqlite_integration

package oauth

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
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
// The developer is active unless status says otherwise.
type developers struct {
	status domain.UserStatus
}

func (d *developers) GetMyUser(_ context.Context, input service.GetMyUserInput) (*domain.User, error) {
	if input.Self.UserID() != testUserID {
		return nil, domain.ErrUserNotFound()
	}
	status := d.status
	if status == "" {
		status = domain.UserStatusActive
	}
	return &domain.User{ID: testUserID, ProjectID: input.Self.ProjectID(), Metadata: domain.UserMetadata{Status: status}}, nil
}

// newTestServer is the authorization server over a real SQLite database: the
// platform project with its keys, one developer, and the consents and the
// records of the tokens issued under them.
func newTestServer(t *testing.T, configure ...func(*Deps)) *Server {
	t.Helper()
	s, _ := newTestServerWithPool(t, configure...)
	return s
}

// newTestServerWithPool is newTestServer, with the database it runs on.
func newTestServerWithPool(t *testing.T, configure ...func(*Deps)) (*Server, *service.DB) {
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
		Users:      &developers{},
	}
	for _, c := range configure {
		c(&deps)
	}
	if deps.Consents == nil {
		deps.Consents = service.NewConsentService(pool, deps.Config.ConsentLifetimes())
	}
	// The directory serves the very app the server holds, so a test that
	// edits one of its APIs edits what the directory answers.
	deps.App = PlatformApp(deps.ProjectID, deps.PublicBase, deps.Config)
	deps.Apps = service.NewAppDirectory(pool, nil, keys, nil, deps.App)
	deps.Registrations = service.NewClientRegistrationService(pool, deps.Consents)
	server, err := New(deps)
	require.NoError(t, err)
	return server, pool
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
	return codeForClient(t, s, CLIClientID, resource)
}

// codeForClient is a code issued to clientID under the developer's consent
// to it, for scope.
func codeForClient(t *testing.T, s *Server, clientID, resource string, scope ...string) string {
	t.Helper()
	consent, err := s.consents.Give(t.Context(), service.GiveConsentInput{
		ProjectID: s.projectID,
		UserID:    testUserID,
		ClientID:  clientID,
		Resource:  resource,
		Scope:     scope,
	})
	require.NoError(t, err)
	code, err := s.newCode(t.Context(), authorizationRequest{
		ClientID:      clientID,
		RedirectURI:   testRedirect,
		CodeChallenge: rfcChallenge,
		Resource:      resource,
		Scope:         scope,
	}, testUserID, consent.ID)
	require.NoError(t, err)
	return code
}

// registerClient registers a client as an MCP client does (RFC 7591) and
// returns its client_id.
func registerClient(t *testing.T, s *Server, name string) string {
	t.Helper()
	body, err := json.Marshal(map[string]any{"client_name": name, "redirect_uris": []string{"http://127.0.0.1/callback"}})
	require.NoError(t, err)
	r := httptest.NewRequest(http.MethodPost, s.namespace()+"/register", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := serve(s, r)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var registered map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &registered))
	return registered["client_id"].(string)
}

// authorizeClient is clientID's authorization request for resource.
func authorizeClient(s *Server, clientID, resource string, extra ...string) *httptest.ResponseRecorder {
	q := url.Values{
		"client_id":             {clientID},
		"response_type":         {"code"},
		"redirect_uri":          {testRedirect},
		"code_challenge":        {rfcChallenge},
		"code_challenge_method": {"S256"},
		"resource":              {resource},
		"state":                 {"client-state"},
	}
	for i := 0; i < len(extra); i += 2 {
		q.Set(extra[i], extra[i+1])
	}
	return serve(s, httptest.NewRequest(http.MethodGet, s.namespace()+"/authorize?"+q.Encode(), nil))
}

// failure is the error a failed authorization request sends the client
// through the login.
func failure(t *testing.T, s *Server, w *httptest.ResponseRecorder) url.Values {
	t.Helper()
	handle, binding := handOff(t, w)
	req, err := s.ResolveAuthRequest(t.Context(), s.projectID, handle, browser(binding))
	require.NoError(t, err)
	require.True(t, req.Failed, "the flow answers it at once")
	target, err := s.Answer(t.Context(), s.projectID, req, "", domain.FlowAuthFailed)
	require.NoError(t, err)
	location, err := url.Parse(target)
	require.NoError(t, err)
	return location.Query()
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
	platform, _ := s.api(PlatformAPISlug)
	mcp, _ := s.api(MCPAPISlug)

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
	platform, _ := s.api(PlatformAPISlug)

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
	platform, _ := s.api(PlatformAPISlug)
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
	platform, _ := s.api(PlatformAPISlug)
	status, first := postToken(t, s, exchange(codeFor(t, s, platform.Identifier), rfcVerifier))
	require.Equal(t, http.StatusOK, status, first)
	other := registerClient(t, s, "Other")

	form := refresh(first["refresh_token"].(string))
	form.Set("client_id", other)
	status, body := postToken(t, s, form)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, errInvalidGrant, body["error"])
}

func TestRevocationEndsTheToken(t *testing.T) {
	s := newTestServer(t)
	platform, _ := s.api(PlatformAPISlug)
	status, first := postToken(t, s, exchange(codeFor(t, s, platform.Identifier), rfcVerifier))
	require.Equal(t, http.StatusOK, status, first)
	rt := first["refresh_token"].(string)

	w := post(s, "/revoke", url.Values{"token": {rt}, "client_id": {CLIClientID}})
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	status, body := postToken(t, s, refresh(rt))
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, errInvalidGrant, body["error"])
}

// fetchKeys reads the JWKS as a verifier does.
func fetchKeys(t *testing.T, s *Server) jose.JSONWebKeySet {
	t.Helper()
	w := serve(s, httptest.NewRequest(http.MethodGet, s.namespace()+"/jwks", nil))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "public, max-age=300", w.Header().Get("Cache-Control"))
	var set jose.JSONWebKeySet
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &set))
	return set
}

// withSigningAlgorithm has an API choose algorithm, as its file would.
func withSigningAlgorithm(t *testing.T, s *Server, slug string, algorithm jose.SignatureAlgorithm) domain.AppAPI {
	t.Helper()
	apis := s.app.Document.APIs
	i := slices.IndexFunc(apis, func(api domain.AppAPI) bool { return api.Slug == slug })
	require.GreaterOrEqual(t, i, 0, slug)
	apis[i].SigningAlg = string(algorithm)
	return apis[i]
}

func TestKeysVerifyTheAccessTokens(t *testing.T) {
	s := newTestServer(t)
	platform, _ := s.api(PlatformAPISlug)
	status, first := postToken(t, s, exchange(codeFor(t, s, platform.Identifier), rfcVerifier))
	require.Equal(t, http.StatusOK, status, first)

	token, err := jose.ParseSigned(first["access_token"].(string), []jose.SignatureAlgorithm{jose.RS256})
	require.NoError(t, err, "signed RS256 unless the API chooses otherwise")
	set := fetchKeys(t, s)
	keys := set.Key(token.Signatures[0].Header.KeyID)
	require.Len(t, keys, 1, "the token's key is published")
	assert.True(t, keys[0].IsPublic(), "only its public half")
	assert.Equal(t, string(jose.RS256), keys[0].Algorithm)
	assert.Equal(t, "sig", keys[0].Use)
	_, err = token.Verify(keys[0])
	assert.NoError(t, err)
}

// A verifier that fetches the keys before the first token finds RS256's
// already (ADR 082 §7). The EdDSA key the project was created with signs no
// token, so the set leaves it out.
func TestKeysOfferRS256BeforeTheFirstToken(t *testing.T) {
	s := newTestServer(t)
	set := fetchKeys(t, s)
	require.Len(t, set.Keys, 1)
	assert.Equal(t, string(jose.RS256), set.Keys[0].Algorithm)

	platform, _ := s.api(PlatformAPISlug)
	token, _, err := s.mintAccessToken(t.Context(), testUserID, CLIClientID, platform, nil)
	require.NoError(t, err)
	parsed, err := jose.ParseSigned(token, []jose.SignatureAlgorithm{jose.RS256})
	require.NoError(t, err)
	assert.Equal(t, set.Keys[0].KeyID, parsed.Signatures[0].Header.KeyID, "the key offered first signs the token")
}

// An API that chooses ES256 has its tokens signed with the project's ES256
// key, minted for its first token and published beside RS256's.
func TestAnAPIMayChooseES256(t *testing.T) {
	s := newTestServer(t)
	mcp := withSigningAlgorithm(t, s, MCPAPISlug, jose.ES256)
	token, _, err := s.mintAccessToken(t.Context(), testUserID, CLIClientID, mcp, nil)
	require.NoError(t, err)

	parsed, err := jose.ParseSigned(token, []jose.SignatureAlgorithm{jose.ES256})
	require.NoError(t, err)
	set := fetchKeys(t, s)
	keys := set.Key(parsed.Signatures[0].Header.KeyID)
	require.Len(t, keys, 1)
	_, err = parsed.Verify(keys[0])
	require.NoError(t, err)
	_, err = s.Verify(t.Context(), token, mcp.Identifier)
	assert.NoError(t, err)

	platform, _ := s.api(PlatformAPISlug)
	token, _, err = s.mintAccessToken(t.Context(), testUserID, CLIClientID, platform, nil)
	require.NoError(t, err)
	_, err = jose.ParseSigned(token, []jose.SignatureAlgorithm{jose.RS256})
	assert.NoError(t, err, "the other API keeps RS256")
}

// Only the project's active key for a token's algorithm verifies it, and
// only an algorithm an API may choose: a key the token merely names, an
// algorithm the project never signed with, or the EdDSA key it signs nothing
// with is a dead token, never a server fault.
func TestATokenAnotherKeySignedIsRefused(t *testing.T) {
	s := newTestServer(t)
	platform, _ := s.api(PlatformAPISlug)
	token, _, err := s.mintAccessToken(t.Context(), testUserID, CLIClientID, platform, nil)
	require.NoError(t, err)
	parsed, err := jose.ParseSigned(token, []jose.SignatureAlgorithm{jose.RS256})
	require.NoError(t, err)
	payload := parsed.UnsafePayloadWithoutVerification()
	kid := parsed.Signatures[0].Header.KeyID

	resign := func(algorithm jose.SignatureAlgorithm, key any, kid string) string {
		signer, err := jose.NewSigner(jose.SigningKey{Algorithm: algorithm, Key: &jose.JSONWebKey{Key: key, KeyID: kid}},
			(&jose.SignerOptions{}).WithType(accessTokenType))
		require.NoError(t, err)
		signed, err := signer.Sign(payload)
		require.NoError(t, err)
		compact, err := signed.CompactSerialize()
		require.NoError(t, err)
		return compact
	}
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	ecKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	eddsaKey, eddsaKEK, err := s.signingKey(t.Context(), jose.EdDSA)
	require.NoError(t, err)
	eddsa, err := eddsaKey.PrivateKey(eddsaKEK)
	require.NoError(t, err)

	for _, tc := range []struct{ name, token string }{
		{"another key under the project key's id", resign(jose.RS256, rsaKey, kid)},
		{"a key the project does not hold", resign(jose.RS256, rsaKey, "sig_key_stranger")},
		{"an algorithm the project never signed with", resign(jose.ES256, ecKey, kid)},
		{"a shared secret", resign(jose.HS256, []byte("a shared secret of thirty-two bytes"), kid)},
		{"the project's EdDSA key", resign(jose.EdDSA, eddsa, eddsaKey.ID)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := s.VerifyPlatformAccessToken(t.Context(), tc.token)
			assert.ErrorIs(t, err, domain.ErrInvalidToken())
		})
	}
}

func TestTokenEndpointRefusesAnUnknownClient(t *testing.T) {
	s := newTestServer(t)
	form := exchange("code", rfcVerifier)
	form.Set("client_id", "unknown")
	status, body := postToken(t, s, form)
	assert.Equal(t, http.StatusUnauthorized, status)
	assert.Equal(t, errInvalidClient, body["error"])
}

// A token is for one API, which the request names as resource: without one
// it would be for userinfo, which this server does not serve (ADR 082 §5).
// A scope the API does not take is refused, never dropped.
func TestAnAuthorizationRequestNamesItsAPIAndScopes(t *testing.T) {
	s := newTestServer(t)

	refused := failure(t, s, authorizeCLI(s, "resource", ""))
	assert.Equal(t, errInvalidTarget, refused.Get("error"))

	refused = failure(t, s, authorizeCLI(s, "resource", "https://other.example.com/api"))
	assert.Equal(t, errInvalidTarget, refused.Get("error"), "no app of the project serves it")

	refused = failure(t, s, authorizeCLI(s, "scope", "openid orders.read"))
	assert.Equal(t, errInvalidScope, refused.Get("error"))
	assert.Contains(t, refused.Get("error_description"), "orders.read")
}

// A client that registers itself is kept in the registration store, joins
// the app whose API its first authorization request names, and gets that
// app's APIs open to third parties.
func TestARegisteredClientJoinsTheAppOfTheAPIItAsksFor(t *testing.T) {
	s := newTestServer(t)
	clientID := registerClient(t, s, "Agent")
	assert.True(t, domain.PrefixClientRegistration.Matches(clientID), clientID)
	platform, _ := s.api(PlatformAPISlug)
	mcp, _ := s.api(MCPAPISlug)

	refused := failure(t, s, authorizeClient(s, clientID, platform.Identifier))
	assert.Equal(t, errInvalidTarget, refused.Get("error"), "the management API is not open to third parties")

	handle, binding := handOff(t, authorizeClient(s, clientID, mcp.Identifier))
	req, err := s.ResolveAuthRequest(t.Context(), s.projectID, handle, browser(binding))
	require.NoError(t, err)
	require.False(t, req.Failed)
	assert.Equal(t, domain.FlowClient{ID: clientID, Name: "Agent", RedirectHost: "127.0.0.1:51234"}, req.Client)
	registration, err := s.registrations.Get(t.Context(), s.projectID, clientID)
	require.NoError(t, err)
	assert.Equal(t, AppSlug, registration.AppSlug, "it joined the MCP server's app")

	status, tokens := postToken(t, s, withClient(exchange(codeForClient(t, s, clientID, mcp.Identifier), rfcVerifier), clientID))
	require.Equal(t, http.StatusOK, status, tokens)
	assert.Nil(t, tokens["refresh_token"], "a third party without offline_access gets none")
}

// Deleting a registered client, as `zitadel client-registrations delete`
// does, deletes the consents users gave it and the tokens issued under them.
func TestDeletingARegisteredClientEndsItsTokens(t *testing.T) {
	s := newTestServer(t)
	clientID := registerClient(t, s, "Agent")
	mcp, _ := s.api(MCPAPISlug)
	handOff(t, authorizeClient(s, clientID, mcp.Identifier))
	status, tokens := postToken(t, s, withClient(exchange(codeForClient(t, s, clientID, mcp.Identifier, "offline_access"), rfcVerifier), clientID))
	require.Equal(t, http.StatusOK, status, tokens)
	require.NotEmpty(t, tokens["refresh_token"])

	require.NoError(t, s.registrations.Delete(t.Context(), s.projectID, clientID))

	_, err := s.consents.Find(t.Context(), s.projectID, testUserID, clientID, mcp.Identifier)
	assert.ErrorIs(t, err, domain.ErrConsentNotFound())
	status, body := postToken(t, s, withClient(refresh(tokens["refresh_token"].(string)), clientID))
	assert.Equal(t, http.StatusUnauthorized, status)
	assert.Equal(t, errInvalidClient, body["error"], "the client is gone")
}

// A registration past its lifetime stays while a consent names it, and goes
// once none does: the purge each registration runs asks the consents.
func TestAConsentKeepsARegisteredClient(t *testing.T) {
	s, pool := newTestServerWithPool(t)
	mcp, _ := s.api(MCPAPISlug)
	consented, unused := registerClient(t, s, "Consented"), registerClient(t, s, "Unused")
	handOff(t, authorizeClient(s, consented, mcp.Identifier))
	codeForClient(t, s, consented, mcp.Identifier)
	for _, id := range []string{consented, unused} {
		require.NoError(t, pool.Statements().ExtendClientRegistration(t.Context(), s.projectID, id, time.Now().Add(-time.Minute)))
	}

	registerClient(t, s, "Next")

	_, err := s.registrations.Get(t.Context(), s.projectID, consented)
	assert.NoError(t, err, "a live consent names it")
	_, err = s.registrations.Get(t.Context(), s.projectID, unused)
	assert.ErrorIs(t, err, domain.ErrClientRegistrationNotFound())
}

func withClient(form url.Values, clientID string) url.Values {
	form.Set("client_id", clientID)
	return form
}

// A refresh that fails before its answer spends nothing: the refresh token
// still works on the retry, instead of reading as a replay that would end
// the consent.
func TestAFailedRefreshSpendsNothing(t *testing.T) {
	s := newTestServer(t)
	platform, _ := s.api(PlatformAPISlug)
	status, first := postToken(t, s, exchange(codeFor(t, s, platform.Identifier), rfcVerifier))
	require.Equal(t, http.StatusOK, status, first)

	withSigningAlgorithm(t, s, PlatformAPISlug, jose.HS256)
	status, body := postToken(t, s, refresh(first["refresh_token"].(string)))
	require.Equal(t, http.StatusInternalServerError, status, body, "the server cannot sign with it")

	withSigningAlgorithm(t, s, PlatformAPISlug, "")
	status, body = postToken(t, s, refresh(first["refresh_token"].(string)))
	assert.Equal(t, http.StatusOK, status, body)
}

// A refresh may narrow the access token's scope, and the refresh token keeps
// the scope it had (RFC 6749 §6).
func TestARefreshNarrowsOnlyItsAccessToken(t *testing.T) {
	s := newTestServer(t)
	platform, _ := s.api(PlatformAPISlug)
	status, first := postToken(t, s, exchange(codeForClient(t, s, CLIClientID, platform.Identifier, "email", "offline_access"), rfcVerifier))
	require.Equal(t, http.StatusOK, status, first)

	form := refresh(first["refresh_token"].(string))
	form.Set("scope", "email")
	status, narrowed := postToken(t, s, form)
	require.Equal(t, http.StatusOK, status, narrowed)
	assert.Equal(t, "email", narrowed["scope"])

	status, after := postToken(t, s, refresh(narrowed["refresh_token"].(string)))
	require.Equal(t, http.StatusOK, status, after)
	assert.Equal(t, "email offline_access", after["scope"], "the narrowed refresh kept the token's scope")
}

// The state is checked first, and a state too long for the handle and the
// flow's cookie is left out of the error the client gets.
func TestALongStateTravelsNowhere(t *testing.T) {
	s := newTestServer(t)
	refused := failure(t, s, authorizeCLI(s, "state", strings.Repeat("s", maxStateLength+1), "resource", ""))
	assert.Equal(t, errInvalidRequest, refused.Get("error"), "the state's failure comes before the resource's")
	assert.NotContains(t, refused, "state")
}

// A browser that started requests and finished none carries a binding
// cookie for each; past the cap, they are cleared as the next one is set.
func TestBindingCookiesAreCapped(t *testing.T) {
	s := newTestServer(t)
	authorize := func(pending int) *http.Response {
		r := httptest.NewRequest(http.MethodGet, s.namespace()+"/authorize?"+url.Values{
			"client_id": {CLIClientID}, "response_type": {"code"}, "redirect_uri": {testRedirect},
			"code_challenge": {rfcChallenge}, "code_challenge_method": {"S256"},
			"resource": {s.app.Document.APIs[0].Identifier},
		}.Encode(), nil)
		for i := range pending {
			r.AddCookie(&http.Cookie{Name: bindingCookieName(fmt.Sprintf("old%d", i), true), Value: "nonce"})
		}
		return serve(s, r).Result()
	}
	cleared := func(res *http.Response) (n int) {
		for _, c := range res.Cookies() {
			if c.MaxAge < 0 {
				n++
			}
		}
		return n
	}

	assert.Zero(t, cleared(authorize(maxBindingCookies-1)), "under the cap the pending requests stay")
	res := authorize(maxBindingCookies)
	assert.Equal(t, maxBindingCookies, cleared(res))
	assert.Len(t, res.Cookies(), maxBindingCookies+1, "and the new request is bound")
}

// A user no longer active, such as one whose owning team was deactivated,
// cannot sign in, so the tokens of their consents end at their next use, as
// a deleted user's do. Reactivating them brings none back.
func TestATokenEndsWithTheUsersActivity(t *testing.T) {
	users := &developers{}
	s := newTestServer(t, func(d *Deps) { d.Users = users })
	platform, _ := s.api(PlatformAPISlug)
	status, first := postToken(t, s, exchange(codeFor(t, s, platform.Identifier), rfcVerifier))
	require.Equal(t, http.StatusOK, status, first)

	users.status = domain.UserStatusDeactivated
	status, body := postToken(t, s, refresh(first["refresh_token"].(string)))
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, errInvalidGrant, body["error"])
	assert.Equal(t, "The user is not active.", body["error_description"])

	users.status = domain.UserStatusActive
	status, body = postToken(t, s, refresh(first["refresh_token"].(string)))
	assert.Equal(t, http.StatusBadRequest, status, body)
	assert.Equal(t, errInvalidGrant, body["error"])
}

// Revoking a consent, as the user does among the apps they connected, ends
// every token issued under it (ADR 082 §8).
func TestRevokingAConsentEndsItsTokens(t *testing.T) {
	s := newTestServer(t)
	platform, _ := s.api(PlatformAPISlug)
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
	platform, _ := s.api(PlatformAPISlug)
	status, laptop := postToken(t, s, exchange(codeFor(t, s, platform.Identifier), rfcVerifier))
	require.Equal(t, http.StatusOK, status, laptop)
	status, desktop := postToken(t, s, exchange(codeFor(t, s, platform.Identifier), rfcVerifier))
	require.Equal(t, http.StatusOK, status, desktop)

	w := post(s, "/revoke", url.Values{"token": {laptop["refresh_token"].(string)}, "client_id": {CLIClientID}})
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	status, body := postToken(t, s, refresh(desktop["refresh_token"].(string)))
	assert.Equal(t, http.StatusOK, status, body)
}

// handOff follows authorize to the login page: the handle in the page's URL,
// and the cookie that binds the request to the browser.
func handOff(t *testing.T, w *httptest.ResponseRecorder) (string, *http.Cookie) {
	t.Helper()
	require.Equal(t, http.StatusSeeOther, w.Code, w.Body.String())
	location, err := url.Parse(w.Header().Get("Location"))
	require.NoError(t, err)
	cookies := w.Result().Cookies()
	require.Len(t, cookies, 1)
	return location.Query().Get("auth_request"), cookies[0]
}

// browser is a cookie jar holding these cookies.
func browser(cookies ...*http.Cookie) func(string) (string, bool) {
	return func(name string) (string, bool) {
		for _, c := range cookies {
			if c.Name == name {
				return c.Value, true
			}
		}
		return "", false
	}
}

// authorizeCLI is the CLI's authorization request, with extra parameters.
func authorizeCLI(s *Server, extra ...string) *httptest.ResponseRecorder {
	platform, _ := s.api(PlatformAPISlug)
	q := url.Values{
		"client_id":             {CLIClientID},
		"response_type":         {"code"},
		"redirect_uri":          {testRedirect},
		"code_challenge":        {rfcChallenge},
		"code_challenge_method": {"S256"},
		"resource":              {platform.Identifier},
		"state":                 {"cli-state"},
	}
	for i := 0; i < len(extra); i += 2 {
		q.Set(extra[i], extra[i+1])
	}
	return serve(s, httptest.NewRequest(http.MethodGet, s.namespace()+"/authorize?"+q.Encode(), nil))
}

// Authorize hands the request to the console's login page, sealed into the
// page's URL and bound to the browser by a cookie of its own (ADR 081 §8).
// The page's flow opens it with both, and its answer is the client's code.
func TestAuthorizeHandsTheRequestToTheLogin(t *testing.T) {
	s := newTestServer(t, func(d *Deps) { d.ConsolePath = "/console" })
	w := authorizeCLI(s, "scope", "openid offline_access")
	location, err := url.Parse(w.Header().Get("Location"))
	require.NoError(t, err)
	assert.Equal(t, testPublicBase+"/console/login", location.Scheme+"://"+location.Host+location.Path)
	handle, binding := handOff(t, w)
	assert.True(t, strings.HasPrefix(binding.Name, "__Host-_zauthz_"), binding.Name)
	assert.True(t, binding.HttpOnly && binding.Secure)
	assert.Equal(t, http.SameSiteLaxMode, binding.SameSite)
	assert.Equal(t, "/", binding.Path)

	req, err := s.ResolveAuthRequest(t.Context(), s.projectID, handle, browser(binding))
	require.NoError(t, err)
	platform, _ := s.api(PlatformAPISlug)
	assert.Equal(t, domain.FlowClient{ID: CLIClientID, Name: "Zitadel CLI", RedirectHost: "127.0.0.1:51234", FirstParty: true}, req.Client)
	assert.Equal(t, domain.FlowAPI{Identifier: platform.Identifier, Name: "Zitadel API"}, req.API)
	assert.Equal(t, []string{"openid", "offline_access"}, req.Scope)
	assert.Equal(t, binding.Name, req.BindingCookie, "the flow clears the cookie it was opened with")

	needs, err := s.NeedsConsent(t.Context(), s.projectID, req, testUserID)
	require.NoError(t, err)
	assert.False(t, needs, "a first-party client is not asked")
	target, err := s.Answer(t.Context(), s.projectID, req, testUserID, domain.FlowAuthAllow)
	require.NoError(t, err)
	answer, err := url.Parse(target)
	require.NoError(t, err)
	assert.Equal(t, "cli-state", answer.Query().Get("state"))
	assert.Equal(t, testPublicBase, answer.Query().Get("iss"))
	status, body := postToken(t, s, exchange(answer.Query().Get("code"), rfcVerifier))
	assert.Equal(t, http.StatusOK, status, body)

	_, err = s.consents.Find(t.Context(), s.projectID, testUserID, CLIClientID, platform.Identifier)
	assert.NoError(t, err, "the CLI's consent is kept, though it was not asked")
}

// A handle opens its request only in the browser that holds the request's own
// binding cookie, and only for the server's project: a link someone else
// starts, or a second request in the same browser, opens nothing.
func TestAnAuthorizationRequestOpensOnlyInItsBrowser(t *testing.T) {
	s := newTestServer(t)
	first, firstBinding := handOff(t, authorizeCLI(s))
	second, secondBinding := handOff(t, authorizeCLI(s))
	assert.NotEqual(t, firstBinding.Name, secondBinding.Name, "each request has a cookie of its own")

	both := browser(firstBinding, secondBinding)
	for name, open := range map[string]func() error{
		"no cookie": func() error {
			_, err := s.ResolveAuthRequest(t.Context(), s.projectID, first, browser())
			return err
		},
		"the other request's cookie": func() error {
			_, err := s.ResolveAuthRequest(t.Context(), s.projectID, first, browser(&http.Cookie{Name: firstBinding.Name, Value: secondBinding.Value}))
			return err
		},
		"another project": func() error {
			_, err := s.ResolveAuthRequest(t.Context(), "proj_other", first, both)
			return err
		},
		"not a handle": func() error {
			_, err := s.ResolveAuthRequest(t.Context(), s.projectID, first[:len(first)-4]+"AAAA", both)
			return err
		},
	} {
		t.Run(name, func(t *testing.T) {
			assert.ErrorIs(t, open(), domain.ErrFlowAuthRequestInvalid())
		})
	}
	for _, handle := range []string{first, second} {
		_, err := s.ResolveAuthRequest(t.Context(), s.projectID, handle, both)
		assert.NoError(t, err, "both requests stay open in their browser")
	}
}

// A user who refuses the consent goes back to the client with access_denied;
// a failure the user has not seen goes back only where failUnasked lets it.
func TestAnAuthorizationRequestsOtherAnswers(t *testing.T) {
	s := newTestServer(t)
	handle, binding := handOff(t, authorizeCLI(s))
	req, err := s.ResolveAuthRequest(t.Context(), s.projectID, handle, browser(binding))
	require.NoError(t, err)

	target, err := s.Answer(t.Context(), s.projectID, req, testUserID, domain.FlowAuthDeny)
	require.NoError(t, err)
	denied, err := url.Parse(target)
	require.NoError(t, err)
	assert.Equal(t, errAccessDenied, denied.Query().Get("error"))
	assert.Equal(t, "cli-state", denied.Query().Get("state"))
	assert.Equal(t, testPublicBase, denied.Query().Get("iss"))
	platform, _ := s.api(PlatformAPISlug)
	_, err = s.consents.Find(t.Context(), s.projectID, testUserID, CLIClientID, platform.Identifier)
	assert.ErrorIs(t, err, domain.ErrConsentNotFound(), "a refusal keeps no consent")

	target, err = s.Answer(t.Context(), s.projectID, req, "", domain.FlowAuthLoginRequired)
	require.NoError(t, err)
	assert.Contains(t, target, "error="+errLoginRequired, "the CLI's loopback URI gets the failure")

	thirdParty := *req
	thirdParty.Client.FirstParty = false
	record := map[string]any{}
	require.NoError(t, json.Unmarshal(req.Record, &record))
	record["redirect_uri"] = "https://app.example/callback"
	thirdParty.Record, err = json.Marshal(record)
	require.NoError(t, err)
	_, err = s.Answer(t.Context(), s.projectID, &thirdParty, "", domain.FlowAuthConsentRequired)
	assert.ErrorIs(t, err, domain.ErrFlowAuthRequestInvalid(), "a registered client's own URI gets no failure the user has not seen")
}

// A failure after the redirect URI checked out goes back through the login,
// as every answer does (ADR 081 §8): the flow answers it at once, to the URL
// the matcher checked, with only the error, the state and the issuer added.
func TestAFailureGoesBackThroughTheLogin(t *testing.T) {
	s := newTestServer(t)
	handle, binding := handOff(t, authorizeCLI(s, "response_type", "token"))
	req, err := s.ResolveAuthRequest(t.Context(), s.projectID, handle, browser(binding))
	require.NoError(t, err)
	require.True(t, req.Failed, "the flow answers it at once")

	target, err := s.Answer(t.Context(), s.projectID, req, "", domain.FlowAuthFailed)
	require.NoError(t, err)
	location, err := url.Parse(target)
	require.NoError(t, err)
	assert.Equal(t, "http", location.Scheme)
	assert.Equal(t, "127.0.0.1:51234", location.Host)
	assert.Equal(t, "/callback", location.EscapedPath())
	assert.Nil(t, location.User)
	assert.Empty(t, location.Fragment)
	assert.Equal(t, url.Values{
		"error":             {errUnsupportedResponseType},
		"error_description": {"Only response_type=code is supported."},
		"state":             {"cli-state"},
		"iss":               {testPublicBase},
	}, location.Query())
}

// A registered client's redirect URI is whatever its registration said, so a
// failure goes there only once the user has seen the app: before that, the
// error page answers (RFC 9700 §4.11.2). A loopback URI is the user's own
// machine, and gets the failure through the login.
func TestAFailureGoesUnaskedOnlyToTheUsersMachine(t *testing.T) {
	redirects := []string{"https://app.example/callback", "http://127.0.0.1/callback"}
	var documentURL string
	documents := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"client_id":     documentURL,
			"client_name":   "Agent",
			"redirect_uris": redirects,
		})
	}))
	t.Cleanup(documents.Close)
	documentURL = documents.URL + "/metadata.json"
	s := newTestServer(t, func(d *Deps) {
		d.Config.ClientIDMetadataDocuments = true
		d.Fetch = documents.Client()
	})
	authorize := func(redirect string) *httptest.ResponseRecorder {
		q := url.Values{"client_id": {documentURL}, "response_type": {"token"}, "redirect_uri": {redirect}}
		return serve(s, httptest.NewRequest(http.MethodGet, s.namespace()+"/authorize?"+q.Encode(), nil))
	}

	refused := authorize(redirects[0])
	assert.Equal(t, http.StatusBadRequest, refused.Code)
	assert.Empty(t, refused.Header().Get("Location"))
	assert.Empty(t, refused.Result().Cookies(), "no request to answer")

	handle, binding := handOff(t, authorize(redirects[1]))
	req, err := s.ResolveAuthRequest(t.Context(), s.projectID, handle, browser(binding))
	require.NoError(t, err)
	target, err := s.Answer(t.Context(), s.projectID, req, "", domain.FlowAuthFailed)
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(target, redirects[1]+"?error="+errUnsupportedResponseType), target)
}

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
		d.Fetch = documents.Client()
	})
	mcp, _ := s.api(MCPAPISlug)
	open := func(scope string, extra ...string) *domain.FlowAuthRequest {
		t.Helper()
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
		handle, binding := handOff(t, serve(s, httptest.NewRequest(http.MethodGet, s.namespace()+"/authorize?"+q.Encode(), nil)))
		req, err := s.ResolveAuthRequest(t.Context(), s.projectID, handle, browser(binding))
		require.NoError(t, err)
		return req
	}
	asks := func(req *domain.FlowAuthRequest) bool {
		t.Helper()
		needs, err := s.NeedsConsent(t.Context(), s.projectID, req, testUserID)
		require.NoError(t, err)
		return needs
	}

	first := open("openid")
	assert.Equal(t, domain.FlowClient{ID: documentURL, Name: "Agent", RedirectHost: "127.0.0.1:51234"}, first.Client)
	require.True(t, asks(first), "a first authorization asks")
	target, err := s.Answer(t.Context(), s.projectID, first, testUserID, domain.FlowAuthAllow)
	require.NoError(t, err)
	assert.Contains(t, target, "code=", "allowing issues a code")

	assert.False(t, asks(open("openid")), "the same scopes need no consent again")
	assert.True(t, asks(open("openid offline_access")), "a scope the user did not agree to asks again")
	assert.True(t, asks(open("openid", "prompt", "consent")), "prompt=consent asks again")
}

// The request rides in the login flow's sealed cookie, which a browser drops
// past 4 KiB: a flow resting on the consent step, with the longest state
// authorize takes and a long client ID metadata document URL, still fits.
func TestAFlowWithAnAuthorizationRequestFitsItsCookie(t *testing.T) {
	long := strings.Repeat("x", 160)
	redirect := "https://app.example/" + long + "/callback"
	var documentURL string
	documents := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"client_id":     documentURL,
			"client_name":   strings.Repeat("Agent ", 10),
			"redirect_uris": []string{redirect},
		})
	}))
	t.Cleanup(documents.Close)
	documentURL = documents.URL + "/" + long + "/metadata.json"
	s := newTestServer(t, func(d *Deps) {
		d.Config.ClientIDMetadataDocuments = true
		d.Fetch = documents.Client()
	})
	mcp, _ := s.api(MCPAPISlug)
	q := url.Values{
		"client_id":             {documentURL},
		"response_type":         {"code"},
		"redirect_uri":          {redirect},
		"code_challenge":        {rfcChallenge},
		"code_challenge_method": {"S256"},
		"resource":              {mcp.Identifier},
		"scope":                 {strings.Join(domain.BuiltinScopes, " ")},
		"state":                 {strings.Repeat("s", maxStateLength)},
	}
	handle, binding := handOff(t, serve(s, httptest.NewRequest(http.MethodGet, s.namespace()+"/authorize?"+q.Encode(), nil)))
	req, err := s.ResolveAuthRequest(t.Context(), s.projectID, handle, browser(binding))
	require.NoError(t, err)

	issued := time.Now()
	state := domain.FlowState{
		ID:            "flow_01JC2XAMPLE0000000000000000",
		ProjectID:     s.projectID,
		UserSchemaURL: schemas.DefaultHumanUserSchemaURL(testSchemaBase),
		DeploymentID:  "dep_01JC2XAMPLE0000000000000000",
		ReleaseID:     "rel_01JC2XAMPLE0000000000000000",
		FlowProgress: domain.FlowProgress{
			DefinitionID:   "fdef_01JC2XAMPLE000000000000000",
			Purpose:        domain.FlowDefinitionPurposeLogin,
			CurrentPurpose: domain.FlowDefinitionPurposeLogin,
			CurrentStep:    "done",
			History:        []string{"identifier", "password"},
			CollectedData: domain.CollectedFlowData{
				UserData: map[string]any{"email": "a.developer.with.a.long.name@example.com"},
				UserID:   testUserID,
			},
		},
		IssuedAt:        issued,
		SessionID:       "sess_01JC2XAMPLE0000000000000000",
		AuthAttemptID:   "aa_01JC2XAMPLE00000000000000000",
		AuthRequest:     req,
		AwaitingConsent: true,
	}
	payload, err := json.Marshal(state)
	require.NoError(t, err)
	crypter, err := s.keys.GetProjectCrypter(t.Context(), s.projectID, domain.EncryptionKeyPurposeCookie)
	require.NoError(t, err)
	sealed, err := crypter.Encrypt(string(payload))
	require.NoError(t, err)
	t.Logf("the flow cookie with its request: %d bytes", len(sealed))
	assert.Less(t, len("_zflow=")+len(sealed), 4096)
}

// Consenting again to more scopes widens the consent the user has, and the
// user's consents list newest first, one per client and API.
func TestConsentingAgainWidensTheConsent(t *testing.T) {
	s := newTestServer(t)
	platform, _ := s.api(PlatformAPISlug)
	mcp, _ := s.api(MCPAPISlug)
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
	platform, _ := s.api(PlatformAPISlug)
	status, first := postToken(t, s, exchange(codeFor(t, s, platform.Identifier), rfcVerifier))
	require.Equal(t, http.StatusOK, status, first)

	status, body := postToken(t, s, refresh(first["refresh_token"].(string)))
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, errInvalidGrant, body["error"])
	_, err := s.consents.Find(t.Context(), s.projectID, testUserID, CLIClientID, platform.Identifier)
	assert.ErrorIs(t, err, domain.ErrConsentNotFound())
}
