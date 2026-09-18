package idp

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/oidc/v3/pkg/client/rp"
	"github.com/zitadel/oidc/v3/pkg/oidc"
	"golang.org/x/oauth2"

	"github.com/zitadel/nextgen/internal/domain"
)

// taggedTransport marks every request it carries, so a handler can tell a
// request made through the client under test from one made through any
// other client.
type taggedTransport struct {
	next http.RoundTripper
}

func (t taggedTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("X-Egress", "tagged")
	return t.next.RoundTrip(r)
}

// provider is a fake OIDC provider: one signing key served at /keys, and
// whatever handler a case installs for the other paths. Every request must
// carry the egress marker.
type provider struct {
	srv     *httptest.Server
	key     *rsa.PrivateKey
	handler http.HandlerFunc
	// keysStatus, when set, replaces the JWKS document with that status.
	keysStatus int
}

func newProvider(t *testing.T) *provider {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	p := &provider{key: key}
	p.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "tagged", r.Header.Get("X-Egress"), "request bypassed the egress client")
		if r.URL.Path == "/keys" {
			if p.keysStatus != 0 {
				w.WriteHeader(p.keysStatus)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
				{Key: &key.PublicKey, KeyID: "k1", Algorithm: "RS256", Use: "sig"},
			}})
			return
		}
		if p.handler == nil {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			return
		}
		p.handler(w, r)
	}))
	t.Cleanup(p.srv.Close)
	return p
}

// connection is a connection to the fake provider with every endpoint
// overridden, so no discovery runs.
func (p *provider) connection(authMethod TokenEndpointAuthMethod, pkce, idTokenMapping bool) Connection {
	return Connection{RevisionID: "idprev_1", SubjectClaim: "sub", OIDC: OIDCConnection{
		Issuer:                  p.srv.URL,
		ClientID:                "client",
		Scopes:                  []string{"openid"},
		TokenEndpointAuthMethod: authMethod,
		PKCEEnabled:             pkce,
		AuthorizationEndpoint:   p.srv.URL + "/authorize",
		TokenEndpoint:           p.srv.URL + "/token",
		UserinfoEndpoint:        p.srv.URL + "/userinfo",
		JWKSURI:                 p.srv.URL + "/keys",
		IDTokenMapping:          idTokenMapping,
	}}
}

// newClient builds the engine client over the tagged egress client.
func (p *provider) newClient(t *testing.T, conn Connection) *OIDCClient {
	c, err := NewOIDCClient(context.Background(), conn, redirectURI, &http.Client{Transport: taggedTransport{next: p.srv.Client().Transport}})
	require.NoError(t, err)
	return c
}

func (p *provider) client(t *testing.T, authMethod TokenEndpointAuthMethod, pkce, idTokenMapping bool) *OIDCClient {
	return p.newClient(t, p.connection(authMethod, pkce, idTokenMapping))
}

// ceremony serves a whole callback: discovery, a token response carrying an
// id_token signed over idClaims, and userinfo serving userinfoBody.
func (p *provider) ceremony(t *testing.T, idClaims map[string]any, userinfoBody string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case oidc.DiscoveryEndpoint:
			discoveryHandler(t)(w, r)
		case "/token":
			require.NoError(t, r.ParseForm())
			assert.Equal(t, "the-code", r.PostForm.Get("code"))
			_, _ = fmt.Fprintf(w, `{"access_token":"the-access-token","token_type":"bearer","id_token":%q}`, sign(t, p.key, jose.RS256, "k1", idClaims))
		case "/userinfo":
			assert.Equal(t, "Bearer the-access-token", r.Header.Get("Authorization"))
			_, _ = w.Write([]byte(userinfoBody))
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}
}

// claims returns a valid id_token claim set for the provider.
func (p *provider) claims() map[string]any {
	now := time.Now()
	return map[string]any{
		"iss":   p.srv.URL,
		"aud":   "client",
		"sub":   "user-1",
		"exp":   now.Add(time.Hour).Unix(),
		"iat":   now.Unix(),
		"nonce": "the-nonce",
	}
}

// sign returns a compact JWS over claims with the given key and algorithm.
func sign(t *testing.T, key any, alg jose.SignatureAlgorithm, kid string, claims map[string]any) string {
	payload, err := json.Marshal(claims)
	require.NoError(t, err)
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: alg, Key: key}, (&jose.SignerOptions{}).WithHeader("kid", kid))
	require.NoError(t, err)
	jws, err := signer.Sign(payload)
	require.NoError(t, err)
	token, err := jws.CompactSerialize()
	require.NoError(t, err)
	return token
}

// unsigned returns an alg=none token, which no library will sign.
func unsigned(t *testing.T, claims map[string]any) string {
	payload, err := json.Marshal(claims)
	require.NoError(t, err)
	enc := base64.RawURLEncoding.EncodeToString
	return enc([]byte(`{"alg":"none","typ":"JWT"}`)) + "." + enc(payload) + "."
}

func tokenWithIDToken(idToken string) *oauth2.Token {
	return (&oauth2.Token{AccessToken: "the-access-token", TokenType: "bearer"}).WithExtra(map[string]any{"id_token": idToken})
}

// tokenHandler serves the token endpoint. check inspects the request after
// the grant has been asserted.
func tokenHandler(t *testing.T, check func(t *testing.T, r *http.Request)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/token", r.URL.Path)
		require.NoError(t, r.ParseForm())
		assert.Equal(t, "authorization_code", r.PostForm.Get("grant_type"))
		assert.Equal(t, "the-code", r.PostForm.Get("code"))
		assert.Equal(t, redirectURI, r.PostForm.Get("redirect_uri"))
		check(t, r)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"the-access-token","token_type":"bearer","id_token":"the-id-token"}`))
	}
}

func TestExchange(t *testing.T) {
	tests := []struct {
		name string
		// handler serves the token endpoint; nil fails the test on any request.
		handler      http.HandlerFunc
		authMethod   TokenEndpointAuthMethod
		pkce         bool
		pkceVerifier string
		// emptySecret passes no client secret instead of the fixture's.
		emptySecret bool
		// timeout bounds the call; zero means none.
		timeout time.Duration
		// wantErr is the domain kind. wantCause is matched against its
		// log-only parent; wantCauseMsg pins a cause that has no sentinel.
		wantErr      error
		wantCause    error
		wantCauseMsg string
	}{
		{
			name: "client_secret_basic sends the secret in the header and the verifier in the form",
			handler: tokenHandler(t, func(t *testing.T, r *http.Request) {
				user, secret, ok := r.BasicAuth()
				require.True(t, ok)
				assert.Equal(t, "client", user)
				assert.Equal(t, "the-secret", secret)
				assert.Empty(t, r.PostForm.Get("client_secret"))
				assert.Equal(t, "the-verifier", r.PostForm.Get("code_verifier"))
			}),
			authMethod:   ClientSecretBasic,
			pkce:         true,
			pkceVerifier: "the-verifier",
		},
		{
			name: "client_secret_post sends the secret in the form",
			handler: tokenHandler(t, func(t *testing.T, r *http.Request) {
				assert.Empty(t, r.Header.Get("Authorization"))
				assert.Equal(t, "client", r.PostForm.Get("client_id"))
				assert.Equal(t, "the-secret", r.PostForm.Get("client_secret"))
			}),
			authMethod:   ClientSecretPost,
			pkce:         true,
			pkceVerifier: "the-verifier",
		},
		{
			name: "a connection without pkce sends no verifier",
			handler: tokenHandler(t, func(t *testing.T, r *http.Request) {
				assert.NotContains(t, r.PostForm, "code_verifier")
			}),
			authMethod: ClientSecretBasic,
		},
		{
			name:         "a connection with pkce and no verifier is a wiring error",
			authMethod:   ClientSecretBasic,
			pkce:         true,
			wantErr:      domain.ErrInternal(nil),
			wantCauseMsg: "callback: pkce verifier is empty",
		},
		{
			name:         "an unresolved client secret is a wiring error",
			authMethod:   ClientSecretBasic,
			emptySecret:  true,
			wantErr:      domain.ErrInternal(nil),
			wantCauseMsg: "callback: client secret is empty",
		},
		{
			name:         "an unknown auth method is a wiring error",
			authMethod:   "private_key_jwt",
			wantErr:      domain.ErrInternal(nil),
			wantCauseMsg: `unknown token endpoint auth method "private_key_jwt"`,
		},
		{
			name: "an error response fails",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"invalid_grant","error_description":"code expired"}`))
			},
			authMethod:   ClientSecretBasic,
			wantErr:      domain.ErrIDPExchangeFailed(nil),
			wantCauseMsg: `oauth2: "invalid_grant" "code expired"`,
		},
		{
			name: "a token response without an access token fails",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"token_type":"bearer"}`))
			},
			authMethod:   ClientSecretBasic,
			wantErr:      domain.ErrIDPExchangeFailed(nil),
			wantCauseMsg: "oauth2: server response missing access_token",
		},
		{
			name: "a token endpoint that does not answer in time fails",
			handler: func(w http.ResponseWriter, r *http.Request) {
				time.Sleep(200 * time.Millisecond)
			},
			authMethod: ClientSecretBasic,
			timeout:    50 * time.Millisecond,
			wantErr:    domain.ErrIDPExchangeFailed(nil),
			wantCause:  context.DeadlineExceeded,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := newProvider(t)
			p.handler = tt.handler
			c := p.client(t, tt.authMethod, tt.pkce, true)

			ctx := context.Background()
			if tt.timeout > 0 {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, tt.timeout)
				t.Cleanup(cancel)
			}
			secret := "the-secret"
			if tt.emptySecret {
				secret = ""
			}
			token, err := c.exchange(ctx, "the-code", tt.pkceVerifier, secret)

			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				assert.Equal(t, tt.wantErr.Error(), err.Error())
				de, ok := errors.AsType[domain.Error](err)
				require.True(t, ok)
				if tt.wantCause != nil {
					assert.ErrorIs(t, de.Parent, tt.wantCause)
				}
				if tt.wantCauseMsg != "" {
					assert.EqualError(t, de.Parent, tt.wantCauseMsg)
				}
				return
			}
			require.NoError(t, err)
			assert.Equal(t, "the-access-token", token.AccessToken)
			assert.Equal(t, "Bearer", token.Type())
			assert.Equal(t, "the-id-token", token.Extra("id_token"))
		})
	}
}

func TestVerifyIDToken(t *testing.T) {
	foreign, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	hmacKey := []byte("the-secret-the-secret-the-secret")

	tests := []struct {
		name string
		// token mints the id_token; nil leaves it out of the response.
		token      func(t *testing.T, p *provider) string
		nonce      string
		keysStatus int
		// wantErr is the domain kind. wantCause is matched against its
		// log-only parent; wantCauseMsg pins a cause that has no sentinel.
		wantErr      error
		wantCause    error
		wantCauseMsg string
	}{
		{
			name:  "a token signed by the provider's key with the attempt's nonce is accepted",
			token: func(t *testing.T, p *provider) string { return sign(t, p.key, jose.RS256, "k1", p.claims()) },
			nonce: "the-nonce",
		},
		{
			name: "an iat within the skew in the future is accepted",
			token: func(t *testing.T, p *provider) string {
				claims := p.claims()
				claims["iat"] = time.Now().Add(clockSkew / 2).Unix()
				return sign(t, p.key, jose.RS256, "k1", claims)
			},
			nonce: "the-nonce",
		},
		{
			name: "multiple audiences with azp naming the client are accepted",
			token: func(t *testing.T, p *provider) string {
				claims := p.claims()
				claims["aud"] = []string{"client", "other"}
				claims["azp"] = "client"
				return sign(t, p.key, jose.RS256, "k1", claims)
			},
			nonce: "the-nonce",
		},
		{
			name:         "a response without an id_token is rejected",
			nonce:        "the-nonce",
			wantErr:      domain.ErrIDPIDTokenInvalid(nil),
			wantCause:    rp.ErrMissingIDToken,
			wantCauseMsg: "id_token missing",
		},
		{
			name:      "alg none is rejected",
			token:     func(t *testing.T, p *provider) string { return unsigned(t, p.claims()) },
			nonce:     "the-nonce",
			wantErr:   domain.ErrIDPIDTokenInvalid(nil),
			wantCause: oidc.ErrSignatureUnsupportedAlg,
		},
		{
			name:      "an HMAC signature is rejected",
			token:     func(t *testing.T, p *provider) string { return sign(t, hmacKey, jose.HS256, "k1", p.claims()) },
			nonce:     "the-nonce",
			wantErr:   domain.ErrIDPIDTokenInvalid(nil),
			wantCause: oidc.ErrSignatureUnsupportedAlg,
		},
		{
			name:      "a signature by a key the JWKS does not serve is rejected",
			token:     func(t *testing.T, p *provider) string { return sign(t, foreign, jose.RS256, "k2", p.claims()) },
			nonce:     "the-nonce",
			wantErr:   domain.ErrIDPIDTokenInvalid(nil),
			wantCause: oidc.ErrSignatureInvalid,
		},
		{
			name:       "a JWKS endpoint that fails rejects the token",
			token:      func(t *testing.T, p *provider) string { return sign(t, p.key, jose.RS256, "k1", p.claims()) },
			nonce:      "the-nonce",
			keysStatus: http.StatusInternalServerError,
			wantErr:    domain.ErrIDPIDTokenInvalid(nil),
			wantCause:  oidc.ErrSignatureInvalid,
		},
		{
			name: "a different issuer is rejected",
			token: func(t *testing.T, p *provider) string {
				claims := p.claims()
				claims["iss"] = "https://other.example.test"
				return sign(t, p.key, jose.RS256, "k1", claims)
			},
			nonce:     "the-nonce",
			wantErr:   domain.ErrIDPIDTokenInvalid(nil),
			wantCause: oidc.ErrIssuerInvalid,
		},
		{
			name: "an audience without the client is rejected",
			token: func(t *testing.T, p *provider) string {
				claims := p.claims()
				claims["aud"] = "other"
				return sign(t, p.key, jose.RS256, "k1", claims)
			},
			nonce:     "the-nonce",
			wantErr:   domain.ErrIDPIDTokenInvalid(nil),
			wantCause: oidc.ErrAudience,
		},
		{
			name: "multiple audiences without azp are rejected",
			token: func(t *testing.T, p *provider) string {
				claims := p.claims()
				claims["aud"] = []string{"client", "other"}
				return sign(t, p.key, jose.RS256, "k1", claims)
			},
			nonce:     "the-nonce",
			wantErr:   domain.ErrIDPIDTokenInvalid(nil),
			wantCause: oidc.ErrAzpMissing,
		},
		{
			name: "an expired token is rejected",
			token: func(t *testing.T, p *provider) string {
				claims := p.claims()
				claims["exp"] = time.Now().Add(-2 * clockSkew).Unix()
				return sign(t, p.key, jose.RS256, "k1", claims)
			},
			nonce:     "the-nonce",
			wantErr:   domain.ErrIDPIDTokenInvalid(nil),
			wantCause: oidc.ErrExpired,
		},
		{
			name: "an expiry within the skew is rejected",
			token: func(t *testing.T, p *provider) string {
				claims := p.claims()
				claims["exp"] = time.Now().Add(clockSkew / 2).Unix()
				return sign(t, p.key, jose.RS256, "k1", claims)
			},
			nonce:     "the-nonce",
			wantErr:   domain.ErrIDPIDTokenInvalid(nil),
			wantCause: oidc.ErrExpired,
		},
		{
			name: "an iat beyond the skew in the future is rejected",
			token: func(t *testing.T, p *provider) string {
				claims := p.claims()
				claims["iat"] = time.Now().Add(2 * clockSkew).Unix()
				return sign(t, p.key, jose.RS256, "k1", claims)
			},
			nonce:     "the-nonce",
			wantErr:   domain.ErrIDPIDTokenInvalid(nil),
			wantCause: oidc.ErrIatInFuture,
		},
		{
			name: "a missing iat is rejected",
			token: func(t *testing.T, p *provider) string {
				claims := p.claims()
				delete(claims, "iat")
				return sign(t, p.key, jose.RS256, "k1", claims)
			},
			nonce:     "the-nonce",
			wantErr:   domain.ErrIDPIDTokenInvalid(nil),
			wantCause: oidc.ErrIatMissing,
		},
		{
			name:      "a nonce other than the attempt's is rejected",
			token:     func(t *testing.T, p *provider) string { return sign(t, p.key, jose.RS256, "k1", p.claims()) },
			nonce:     "another-nonce",
			wantErr:   domain.ErrIDPIDTokenInvalid(nil),
			wantCause: oidc.ErrNonceInvalid,
		},
		{
			name: "a missing nonce is rejected",
			token: func(t *testing.T, p *provider) string {
				claims := p.claims()
				delete(claims, "nonce")
				return sign(t, p.key, jose.RS256, "k1", claims)
			},
			nonce:     "the-nonce",
			wantErr:   domain.ErrIDPIDTokenInvalid(nil),
			wantCause: oidc.ErrNonceInvalid,
		},
		{
			name: "an at_hash that does not match the access token is rejected",
			token: func(t *testing.T, p *provider) string {
				claims := p.claims()
				claims["at_hash"] = "not-the-hash"
				return sign(t, p.key, jose.RS256, "k1", claims)
			},
			nonce:     "the-nonce",
			wantErr:   domain.ErrIDPIDTokenInvalid(nil),
			wantCause: oidc.ErrAtHash,
		},
		{
			name:         "an empty nonce is a wiring error",
			token:        func(t *testing.T, p *provider) string { return sign(t, p.key, jose.RS256, "k1", p.claims()) },
			wantErr:      domain.ErrInternal(nil),
			wantCauseMsg: "callback: nonce is empty",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := newProvider(t)
			p.keysStatus = tt.keysStatus
			c := p.client(t, ClientSecretBasic, true, true)
			token := &oauth2.Token{AccessToken: "the-access-token", TokenType: "bearer"}
			if tt.token != nil {
				token = tokenWithIDToken(tt.token(t, p))
			}

			claims, err := c.verifyIDToken(context.Background(), token, tt.nonce)

			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				assert.Equal(t, tt.wantErr.Error(), err.Error())
				de, ok := errors.AsType[domain.Error](err)
				require.True(t, ok)
				if tt.wantCause != nil {
					assert.ErrorIs(t, de.Parent, tt.wantCause)
				}
				if tt.wantCauseMsg != "" {
					assert.EqualError(t, de.Parent, tt.wantCauseMsg)
				}
				return
			}
			require.NoError(t, err)
			assert.Equal(t, "user-1", claims.Subject)
			assert.Equal(t, "the-nonce", claims.Nonce)
		})
	}
}

func TestExtractClaims(t *testing.T) {
	// The claim set both sources serve. The id is a JSON number above 2^53,
	// which float64 would round.
	const body = `{"sub":"user-1","email":"ada@example.test","email_verified":true,"id":9007199254740993}`
	want := map[string]any{
		"sub":            "user-1",
		"email":          "ada@example.test",
		"email_verified": true,
		"id":             json.Number("9007199254740993"),
	}
	userinfo := func(status int, body string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			require.Equal(t, "/userinfo", r.URL.Path)
			assert.Equal(t, http.MethodGet, r.Method)
			assert.Equal(t, "Bearer the-access-token", r.Header.Get("Authorization"))
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_, _ = w.Write([]byte(body))
		}
	}

	tests := []struct {
		name           string
		idTokenMapping bool
		// handler serves userinfo; nil fails the test on any request.
		handler http.HandlerFunc
		want    map[string]any
		// wantErr is the domain kind. wantCause is matched against its
		// log-only parent; wantCauseMsg pins a cause that has no sentinel.
		wantErr      error
		wantCause    error
		wantCauseMsg string
	}{
		{
			name:           "id_token_mapping reads the id_token payload and makes no request",
			idTokenMapping: true,
			want:           want,
		},
		{
			name:    "userinfo is fetched with the access token",
			handler: userinfo(http.StatusOK, body),
			want:    want,
		},
		{
			name:         "a userinfo sub other than the id_token's fails",
			handler:      userinfo(http.StatusOK, `{"sub":"user-2","email":"ada@example.test"}`),
			wantErr:      domain.ErrIDPUserinfoFailed(nil),
			wantCause:    rp.ErrUserInfoSubNotMatching,
			wantCauseMsg: "sub from userinfo does not match the sub from the id_token",
		},
		{
			name:         "a non-2xx userinfo status fails",
			handler:      userinfo(http.StatusUnauthorized, `{"error":"invalid_token"}`),
			wantErr:      domain.ErrIDPUserinfoFailed(nil),
			wantCauseMsg: "userinfo: unexpected status 401",
		},
		{
			name:         "a userinfo body that is not a JSON object fails",
			handler:      userinfo(http.StatusOK, `"ada@example.test"`),
			wantErr:      domain.ErrIDPUserinfoFailed(nil),
			wantCauseMsg: "json: cannot unmarshal string into Go value of type map[string]interface {}",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := newProvider(t)
			p.handler = tt.handler
			c := p.client(t, ClientSecretBasic, true, tt.idTokenMapping)
			claims := p.claims()
			claims["email"] = "ada@example.test"
			claims["email_verified"] = true
			claims["id"] = json.Number("9007199254740993")
			token := tokenWithIDToken(sign(t, p.key, jose.RS256, "k1", claims))
			idToken, err := c.verifyIDToken(context.Background(), token, "the-nonce")
			require.NoError(t, err)

			got, err := c.extractClaims(context.Background(), token, idToken)

			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				assert.Equal(t, tt.wantErr.Error(), err.Error())
				de, ok := errors.AsType[domain.Error](err)
				require.True(t, ok)
				if tt.wantCause != nil {
					assert.ErrorIs(t, de.Parent, tt.wantCause)
				}
				if tt.wantCauseMsg != "" {
					assert.EqualError(t, de.Parent, tt.wantCauseMsg)
				}
				return
			}
			require.NoError(t, err)
			for name, value := range tt.want {
				assert.Equal(t, value, got[name], name)
			}
		})
	}
}

func TestCallback(t *testing.T) {
	mapping := map[string]string{"email": "email", "givenName": "given_name", "familyName": "family_name"}
	verified := map[string]VerificationSource{
		"email":     {Kind: VerifyByClaim, Claim: "email_verified"},
		"givenName": {Kind: VerifyByTrust},
	}
	profile := func(p *provider) map[string]any {
		claims := p.claims()
		claims["email"] = "ada@example.test"
		claims["email_verified"] = true
		claims["given_name"] = "Ada"
		return claims
	}
	const userinfo = `{"sub":"user-1","email":"ada@example.test","email_verified":true,"given_name":"Ada"}`
	wantIdentity := ExternalIdentity{
		Subject:    "user-1",
		Claims:     map[string]any{"email": "ada@example.test", "givenName": "Ada"},
		Verified:   map[string]bool{"email": true, "givenName": true},
		RevisionID: "idprev_1",
	}

	tests := []struct {
		name string
		conn func(p *provider) Connection
		// handler serves the provider; nil serves the ceremony above.
		handler      func(p *provider) http.HandlerFunc
		req          CallbackRequest
		want         ExternalIdentity
		wantErr      error
		wantCause    error
		wantCauseMsg string
	}{
		{
			name: "OIDC via discovery, claims from userinfo",
			conn: func(p *provider) Connection {
				conn := p.connection(ClientSecretBasic, true, false)
				conn.OIDC.AuthorizationEndpoint, conn.OIDC.TokenEndpoint, conn.OIDC.UserinfoEndpoint, conn.OIDC.JWKSURI = "", "", "", ""
				conn.ClaimMapping, conn.VerifiedClaims = mapping, verified
				return conn
			},
			req:  CallbackRequest{Code: "the-code", Nonce: "the-nonce", PKCEVerifier: "the-verifier", ClientSecret: "the-secret"},
			want: wantIdentity,
		},
		{
			name: "OIDC with full overrides, claims from the id_token, client_secret_post, no PKCE",
			conn: func(p *provider) Connection {
				conn := p.connection(ClientSecretPost, false, true)
				conn.ClaimMapping, conn.VerifiedClaims = mapping, verified
				return conn
			},
			req:  CallbackRequest{Code: "the-code", Nonce: "the-nonce", ClientSecret: "the-secret"},
			want: wantIdentity,
		},
		{
			name: "the strategy overwrites its claims and vouches for them",
			conn: func(p *provider) Connection {
				conn := p.connection(ClientSecretBasic, true, true)
				conn.ClaimMapping = mapping
				conn.VerifiedClaims = map[string]VerificationSource{"email": {Kind: VerifyByStrategy}}
				return conn
			},
			req: CallbackRequest{Code: "the-code", Nonce: "the-nonce", PKCEVerifier: "the-verifier", ClientSecret: "the-secret",
				SupplementaryFetch: func(ctx context.Context, in StrategyInput) (StrategyResult, error) {
					assert.Equal(t, "idprev_1", in.Connection.RevisionID)
					assert.Equal(t, "the-access-token", in.AccessToken)
					assert.Equal(t, "Bearer", in.TokenType)
					assert.NotNil(t, in.HTTPClient)
					return StrategyResult{Claims: map[string]any{"email": "primary@example.test"}, Verified: map[string]bool{"email": true}}, nil
				}},
			want: ExternalIdentity{
				Subject:    "user-1",
				Claims:     map[string]any{"email": "primary@example.test", "givenName": "Ada"},
				Verified:   map[string]bool{"email": true},
				RevisionID: "idprev_1",
			},
		},
		{
			name: "a strategy failure ends the attempt",
			conn: func(p *provider) Connection { return p.connection(ClientSecretBasic, true, true) },
			req: CallbackRequest{Code: "the-code", Nonce: "the-nonce", PKCEVerifier: "the-verifier", ClientSecret: "the-secret",
				SupplementaryFetch: func(context.Context, StrategyInput) (StrategyResult, error) {
					return StrategyResult{}, errors.New("emails: status 500")
				}},
			wantErr:      domain.ErrIDPSupplementaryFetchFailed(nil),
			wantCauseMsg: "emails: status 500",
		},
		{
			name: "a subject claim the provider does not send ends the attempt",
			conn: func(p *provider) Connection {
				conn := p.connection(ClientSecretBasic, true, true)
				conn.SubjectClaim = "oid"
				return conn
			},
			req:          CallbackRequest{Code: "the-code", Nonce: "the-nonce", PKCEVerifier: "the-verifier", ClientSecret: "the-secret"},
			wantErr:      domain.ErrIDPSubjectInvalid(nil),
			wantCauseMsg: "subject claim oid is absent",
		},
		{
			name: "a failing step ends the attempt with its own kind",
			conn: func(p *provider) Connection { return p.connection(ClientSecretBasic, true, true) },
			handler: func(p *provider) http.HandlerFunc {
				return func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(http.StatusBadRequest)
					_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
				}
			},
			req:     CallbackRequest{Code: "the-code", Nonce: "the-nonce", PKCEVerifier: "the-verifier", ClientSecret: "the-secret"},
			wantErr: domain.ErrIDPExchangeFailed(nil),
		},
		{
			name:         "an empty code is a wiring error",
			conn:         func(p *provider) Connection { return p.connection(ClientSecretBasic, true, true) },
			req:          CallbackRequest{Nonce: "the-nonce", PKCEVerifier: "the-verifier", ClientSecret: "the-secret"},
			wantErr:      domain.ErrInternal(nil),
			wantCauseMsg: "callback: code is empty",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := newProvider(t)
			p.handler = p.ceremony(t, profile(p), userinfo)
			if tt.handler != nil {
				p.handler = tt.handler(p)
			}
			c := p.newClient(t, tt.conn(p))

			got, err := c.Callback(context.Background(), tt.req)

			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				assert.Equal(t, tt.wantErr.Error(), err.Error())
				de, ok := errors.AsType[domain.Error](err)
				require.True(t, ok)
				if tt.wantCause != nil {
					assert.ErrorIs(t, de.Parent, tt.wantCause)
				}
				if tt.wantCauseMsg != "" {
					assert.EqualError(t, de.Parent, tt.wantCauseMsg)
				}
				assert.Equal(t, ExternalIdentity{}, got)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
			// No provider token on the identity, in any field.
			serialized, err := json.Marshal(got)
			require.NoError(t, err)
			for _, planted := range []string{"the-access-token", "the-secret", "the-verifier", "eyJ"} {
				assert.NotContains(t, string(serialized), planted)
			}
		})
	}
}

func TestEvaluateVerified(t *testing.T) {
	conn := Connection{
		ClaimMapping: map[string]string{"email": "email", "name": "name", "phone": "phone_number"},
		VerifiedClaims: map[string]VerificationSource{
			"email":    {Kind: VerifyByClaim, Claim: "email_verified"},
			"name":     {Kind: VerifyByTrust},
			"phone":    {Kind: VerifyByStrategy},
			"unmapped": {Kind: VerifyByStrategy},
		},
	}
	strategy := StrategyResult{Verified: map[string]bool{"phone_number": true}}
	tests := []struct {
		name   string
		claims map[string]any
		want   map[string]bool
	}{
		{
			name:   "every source vouches for a present value",
			claims: map[string]any{"email": "ada@example.test", "email_verified": true, "name": "Ada", "phone_number": "+41"},
			want:   map[string]bool{"email": true, "name": true, "phone": true, "unmapped": false},
		},
		{
			name:   `the string "true" is verified`,
			claims: map[string]any{"email": "ada@example.test", "email_verified": "true"},
			want:   map[string]bool{"email": true, "name": false, "phone": false, "unmapped": false},
		},
		{
			name:   `the string "TRUE" is unverified`,
			claims: map[string]any{"email": "ada@example.test", "email_verified": "TRUE"},
			want:   map[string]bool{"email": false, "name": false, "phone": false, "unmapped": false},
		},
		{
			name:   "the number 1 is unverified",
			claims: map[string]any{"email": "ada@example.test", "email_verified": json.Number("1")},
			want:   map[string]bool{"email": false, "name": false, "phone": false, "unmapped": false},
		},
		{
			name:   `the string "yes" is unverified`,
			claims: map[string]any{"email": "ada@example.test", "email_verified": "yes"},
			want:   map[string]bool{"email": false, "name": false, "phone": false, "unmapped": false},
		},
		{
			name:   "the boolean false is unverified",
			claims: map[string]any{"email": "ada@example.test", "email_verified": false},
			want:   map[string]bool{"email": false, "name": false, "phone": false, "unmapped": false},
		},
		{
			name:   "an absent verification claim is unverified",
			claims: map[string]any{"email": "ada@example.test"},
			want:   map[string]bool{"email": false, "name": false, "phone": false, "unmapped": false},
		},
		{
			name:   "no source vouches for an absent value",
			claims: map[string]any{"email_verified": true},
			want:   map[string]bool{"email": false, "name": false, "phone": false, "unmapped": false},
		},
		{
			name:   "no source vouches for a null value",
			claims: map[string]any{"email": nil, "email_verified": true, "name": nil, "phone_number": nil},
			want:   map[string]bool{"email": false, "name": false, "phone": false, "unmapped": false},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, evaluateVerified(conn, tt.claims, strategy))
		})
	}
}

func TestCoerceSubject(t *testing.T) {
	tests := []struct {
		name string
		// claims is the decoded claim set; the subject claim is sub.
		claims       string
		want         string
		wantCauseMsg string
	}{
		{name: "a string is used verbatim", claims: `{"sub":"user-1"}`, want: "user-1"},
		{name: "a number keeps its exact digits", claims: `{"sub":9007199254740993}`, want: "9007199254740993"},
		{name: "an absent subject is refused", claims: `{}`, wantCauseMsg: "subject claim sub is absent"},
		{name: "a null subject is refused", claims: `{"sub":null}`, wantCauseMsg: "subject claim sub is <nil>"},
		{name: "an empty subject is refused", claims: `{"sub":""}`, wantCauseMsg: "subject claim sub is empty"},
		{name: "a boolean subject is refused", claims: `{"sub":true}`, wantCauseMsg: "subject claim sub is bool"},
		{name: "an object subject is refused", claims: `{"sub":{"id":1}}`, wantCauseMsg: "subject claim sub is map[string]interface {}"},
		{name: "an array subject is refused", claims: `{"sub":[1]}`, wantCauseMsg: "subject claim sub is []interface {}"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			claims, err := decodeClaims(strings.NewReader(tt.claims))
			require.NoError(t, err)

			got, err := coerceSubject("sub", claims)

			if tt.wantCauseMsg != "" {
				require.ErrorIs(t, err, domain.ErrIDPSubjectInvalid(nil))
				de, ok := errors.AsType[domain.Error](err)
				require.True(t, ok)
				assert.EqualError(t, de.Parent, tt.wantCauseMsg)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

// TestCallbackLeaksNothing runs every failing step with planted values and
// checks that none reach the user-facing text or details, and that no
// secret, verifier, or token reaches the log-only cause either.
func TestCallbackLeaksNothing(t *testing.T) {
	const (
		secret   = "planted-secret"
		verifier = "planted-verifier"
		code     = "planted-code"
		access   = "planted-access-token"
		email    = "planted@example.test"
		query    = "tenant=planted-query"
	)
	req := CallbackRequest{Code: code, Nonce: "the-nonce", PKCEVerifier: verifier, ClientSecret: secret}
	tokenResponse := func(t *testing.T, p *provider, w http.ResponseWriter, claims map[string]any) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"access_token":%q,"token_type":"bearer","id_token":%q}`, access, sign(t, p.key, jose.RS256, "k1", claims))
	}

	tests := []struct {
		name    string
		conn    func(p *provider) Connection
		handler func(t *testing.T, p *provider) http.HandlerFunc
		req     func() CallbackRequest
		wantErr error
	}{
		{
			name: "the token endpoint rejects the exchange",
			handler: func(t *testing.T, p *provider) http.HandlerFunc {
				return func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(http.StatusBadRequest)
					_, _ = w.Write([]byte(`{"error":"invalid_client"}`))
				}
			},
			wantErr: domain.ErrIDPExchangeFailed(nil),
		},
		{
			name: "the token endpoint with a query string does not answer",
			conn: func(p *provider) Connection {
				conn := p.connection(ClientSecretBasic, true, true)
				conn.OIDC.TokenEndpoint += "?" + query
				return conn
			},
			handler: func(t *testing.T, p *provider) http.HandlerFunc {
				return func(w http.ResponseWriter, r *http.Request) { time.Sleep(200 * time.Millisecond) }
			},
			wantErr: domain.ErrIDPExchangeFailed(nil),
		},
		{
			name: "the id_token carries another nonce",
			handler: func(t *testing.T, p *provider) http.HandlerFunc {
				return func(w http.ResponseWriter, r *http.Request) {
					claims := p.claims()
					claims["nonce"], claims["email"] = "another-nonce", email
					tokenResponse(t, p, w, claims)
				}
			},
			wantErr: domain.ErrIDPIDTokenInvalid(nil),
		},
		{
			name: "userinfo answers with another subject",
			conn: func(p *provider) Connection { return p.connection(ClientSecretBasic, true, false) },
			handler: func(t *testing.T, p *provider) http.HandlerFunc {
				return func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == "/userinfo" {
						_, _ = fmt.Fprintf(w, `{"sub":"user-2","email":%q}`, email)
						return
					}
					tokenResponse(t, p, w, p.claims())
				}
			},
			wantErr: domain.ErrIDPUserinfoFailed(nil),
		},
		{
			name: "the strategy fails",
			handler: func(t *testing.T, p *provider) http.HandlerFunc {
				return func(w http.ResponseWriter, r *http.Request) { tokenResponse(t, p, w, p.claims()) }
			},
			req: func() CallbackRequest {
				r := req
				r.SupplementaryFetch = func(context.Context, StrategyInput) (StrategyResult, error) {
					return StrategyResult{}, errors.New("emails: status 500")
				}
				return r
			},
			wantErr: domain.ErrIDPSupplementaryFetchFailed(nil),
		},
		{
			name: "the subject is a boolean",
			handler: func(t *testing.T, p *provider) http.HandlerFunc {
				return func(w http.ResponseWriter, r *http.Request) {
					claims := p.claims()
					claims["oid"], claims["email"] = true, email
					tokenResponse(t, p, w, claims)
				}
			},
			conn: func(p *provider) Connection {
				conn := p.connection(ClientSecretBasic, true, true)
				conn.SubjectClaim = "oid"
				return conn
			},
			wantErr: domain.ErrIDPSubjectInvalid(nil),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := newProvider(t)
			p.handler = tt.handler(t, p)
			conn := p.connection(ClientSecretBasic, true, true)
			if tt.conn != nil {
				conn = tt.conn(p)
			}
			c := p.newClient(t, conn)
			request := req
			if tt.req != nil {
				request = tt.req()
			}
			ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
			t.Cleanup(cancel)

			_, err := c.Callback(ctx, request)

			require.ErrorIs(t, err, tt.wantErr)
			de, ok := errors.AsType[domain.Error](err)
			require.True(t, ok)
			visible := de.Error() + fmt.Sprint(de.Details)
			for _, planted := range []string{secret, verifier, code, access, email, query, "eyJ"} {
				assert.NotContains(t, visible, planted, "user-facing text")
			}
			for _, planted := range []string{secret, verifier, access, "eyJ"} {
				assert.NotContains(t, de.Parent.Error(), planted, "log-only cause")
			}
		})
	}
}
