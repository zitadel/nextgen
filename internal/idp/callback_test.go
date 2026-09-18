package idp

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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

// client builds the engine client for the fake provider with every endpoint
// overridden, so no discovery runs.
func (p *provider) client(t *testing.T, authMethod TokenEndpointAuthMethod, pkce, idTokenMapping bool) *OIDCClient {
	conn := Connection{RevisionID: "idprev_1", OIDC: OIDCConnection{
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
	c, err := NewOIDCClient(context.Background(), conn, redirectURI, &http.Client{Transport: taggedTransport{next: p.srv.Client().Transport}})
	require.NoError(t, err)
	return c
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
			token, err := c.exchange(ctx, "the-code", tt.pkceVerifier, "the-secret")

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
