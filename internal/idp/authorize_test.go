package idp

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/oidc/v3/pkg/oidc"

	"github.com/zitadel/nextgen/internal/domain"
)

const redirectURI = "https://app.example.test/__nextgen/idp/callback"

func TestOIDCClientAuthorize(t *testing.T) {
	// Every endpoint is overridden, so construction makes no request; the
	// server fails the test if one arrives.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
	}))
	t.Cleanup(srv.Close)
	base := Connection{
		RevisionID: "idprev_1",
		OIDC: OIDCConnection{
			Issuer:                srv.URL,
			ClientID:              "client",
			Scopes:                []string{"openid", "email"},
			PKCEEnabled:           true,
			AuthorizationEndpoint: srv.URL + "/authorize",
			TokenEndpoint:         srv.URL + "/token",
			UserinfoEndpoint:      srv.URL + "/userinfo",
			JWKSURI:               srv.URL + "/keys",
		},
	}
	req := AuthorizeRequest{State: "state-1", Nonce: "nonce-1", PKCEVerifier: "verifier-1"}

	tests := []struct {
		name string
		conn func(c Connection) Connection
		req  AuthorizeRequest
		// wantParams is the full query; wantRedirect the record inputs.
		wantParams   url.Values
		wantRedirect AuthorizeRedirect
		wantErr      error
	}{
		{
			name: "the engine sets every protocol parameter",
			conn: func(c Connection) Connection { return c },
			req:  req,
			wantParams: url.Values{
				"client_id":             {"client"},
				"redirect_uri":          {redirectURI},
				"response_type":         {"code"},
				"scope":                 {"openid email"},
				"state":                 {"state-1"},
				"nonce":                 {"nonce-1"},
				"code_challenge":        {oidc.NewSHACodeChallenge("verifier-1")},
				"code_challenge_method": {"S256"},
			},
			wantRedirect: AuthorizeRedirect{
				State:        "state-1",
				Nonce:        "nonce-1",
				PKCEVerifier: "verifier-1",
				RedirectURI:  redirectURI,
				RevisionID:   "idprev_1",
			},
		},
		{
			name: "static parameters are appended and reserved keys dropped",
			conn: func(c Connection) Connection {
				c.OIDC.StaticAuthorizeParameters = map[string]string{
					"prompt":        "select_account",
					"hd":            "example.test",
					"state":         "attacker",
					"nonce":         "attacker",
					"client_secret": "leak",
				}
				return c
			},
			req: req,
			wantParams: url.Values{
				"client_id":             {"client"},
				"redirect_uri":          {redirectURI},
				"response_type":         {"code"},
				"scope":                 {"openid email"},
				"state":                 {"state-1"},
				"nonce":                 {"nonce-1"},
				"code_challenge":        {oidc.NewSHACodeChallenge("verifier-1")},
				"code_challenge_method": {"S256"},
				"prompt":                {"select_account"},
				"hd":                    {"example.test"},
			},
			wantRedirect: AuthorizeRedirect{
				State:        "state-1",
				Nonce:        "nonce-1",
				PKCEVerifier: "verifier-1",
				RedirectURI:  redirectURI,
				RevisionID:   "idprev_1",
			},
		},
		{
			name: "pkce disabled sends no challenge and records no verifier",
			conn: func(c Connection) Connection {
				c.OIDC.PKCEEnabled = false
				return c
			},
			req: req,
			wantParams: url.Values{
				"client_id":     {"client"},
				"redirect_uri":  {redirectURI},
				"response_type": {"code"},
				"scope":         {"openid email"},
				"state":         {"state-1"},
				"nonce":         {"nonce-1"},
			},
			wantRedirect: AuthorizeRedirect{
				State:       "state-1",
				Nonce:       "nonce-1",
				RedirectURI: redirectURI,
				RevisionID:  "idprev_1",
			},
		},
		{
			name:    "an empty state is refused",
			conn:    func(c Connection) Connection { return c },
			req:     AuthorizeRequest{Nonce: "nonce-1", PKCEVerifier: "verifier-1"},
			wantErr: domain.ErrInternal(nil),
		},
		{
			name:    "an empty nonce is refused",
			conn:    func(c Connection) Connection { return c },
			req:     AuthorizeRequest{State: "state-1", PKCEVerifier: "verifier-1"},
			wantErr: domain.ErrInternal(nil),
		},
		{
			name:    "an empty verifier is refused when pkce is enabled",
			conn:    func(c Connection) Connection { return c },
			req:     AuthorizeRequest{State: "state-1", Nonce: "nonce-1"},
			wantErr: domain.ErrInternal(nil),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, err := NewOIDCClient(context.Background(), tt.conn(base), redirectURI, srv.Client())
			require.NoError(t, err)

			got, err := c.Authorize(tt.req)

			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			u, err := url.Parse(got.URL)
			require.NoError(t, err)
			assert.Equal(t, srv.URL+"/authorize", u.Scheme+"://"+u.Host+u.Path)
			assert.Equal(t, tt.wantParams, u.Query())
			got.URL = ""
			assert.Equal(t, tt.wantRedirect, got)
		})
	}
}

// TestOIDCClientAuthorizeViaDiscovery covers the other construction path:
// no override, so the authorize URL is the one discovery named.
func TestOIDCClientAuthorizeViaDiscovery(t *testing.T) {
	srv := httptest.NewServer(discoveryHandler(t))
	t.Cleanup(srv.Close)
	conn := Connection{
		RevisionID: "idprev_1",
		OIDC: OIDCConnection{
			Issuer:      srv.URL,
			ClientID:    "client",
			Scopes:      []string{"openid"},
			PKCEEnabled: true,
		},
	}
	c, err := NewOIDCClient(context.Background(), conn, redirectURI, srv.Client())
	require.NoError(t, err)

	got, err := c.Authorize(AuthorizeRequest{State: "state-1", Nonce: "nonce-1", PKCEVerifier: "verifier-1"})

	require.NoError(t, err)
	u, err := url.Parse(got.URL)
	require.NoError(t, err)
	assert.Equal(t, srv.URL+"/authorize", u.Scheme+"://"+u.Host+u.Path)
	assert.Equal(t, url.Values{
		"client_id":             {"client"},
		"redirect_uri":          {redirectURI},
		"response_type":         {"code"},
		"scope":                 {"openid"},
		"state":                 {"state-1"},
		"nonce":                 {"nonce-1"},
		"code_challenge":        {oidc.NewSHACodeChallenge("verifier-1")},
		"code_challenge_method": {"S256"},
	}, u.Query())
}

func TestRandomTokens(t *testing.T) {
	for name, generate := range map[string]func() string{"nonce": NewNonce, "pkce verifier": NewPKCEVerifier} {
		t.Run(name, func(t *testing.T) {
			a, b := generate(), generate()
			assert.NotEqual(t, a, b)
			assert.Len(t, a, 43)
			raw, err := base64.RawURLEncoding.DecodeString(a)
			require.NoError(t, err)
			assert.Len(t, raw, 32, "256 bits of entropy")
		})
	}
}
