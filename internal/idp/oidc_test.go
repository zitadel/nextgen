package idp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/oidc/v3/pkg/oidc"

	"github.com/zitadel/nextgen/internal/domain"
)

// discoveryHandler serves a complete document keyed on the request host, so
// its issuer equals the test server's URL.
func discoveryHandler(t *testing.T) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, oidc.DiscoveryEndpoint, r.URL.Path)
		issuer := "http://" + r.Host
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"issuer":"` + issuer + `",` +
			`"authorization_endpoint":"` + issuer + `/authorize",` +
			`"token_endpoint":"` + issuer + `/token",` +
			`"userinfo_endpoint":"` + issuer + `/userinfo",` +
			`"jwks_uri":"` + issuer + `/keys"}`))
	}
}

func TestNewOIDCClient(t *testing.T) {
	const redirectURI = "https://app.example.test/__nextgen/idp/callback"
	overrides := OIDCConnection{
		AuthorizationEndpoint: "https://override.example.test/authorize",
		TokenEndpoint:         "https://override.example.test/token",
		UserinfoEndpoint:      "https://override.example.test/userinfo",
		JWKSURI:               "https://override.example.test/keys",
	}

	tests := []struct {
		name string
		// handler serves the provider; nil fails the test on any request.
		handler http.HandlerFunc
		conn    func(issuer string) OIDCConnection
		// timeout bounds the call; zero means none.
		timeout time.Duration
		want    func(issuer string) Endpoints
		// wantErr is the domain kind. wantCause is matched against its
		// log-only parent; wantCauseMsg pins a cause that has no sentinel.
		wantErr      error
		wantCause    error
		wantCauseMsg string
	}{
		{
			name:    "discovery supplies every endpoint",
			handler: discoveryHandler(t),
			conn:    func(issuer string) OIDCConnection { return OIDCConnection{Issuer: issuer} },
			want: func(issuer string) Endpoints {
				return Endpoints{
					Authorization: issuer + "/authorize",
					Token:         issuer + "/token",
					Userinfo:      issuer + "/userinfo",
					JWKS:          issuer + "/keys",
				}
			},
		},
		{
			name:    "an override wins over the discovered value",
			handler: discoveryHandler(t),
			conn: func(issuer string) OIDCConnection {
				return OIDCConnection{Issuer: issuer, JWKSURI: overrides.JWKSURI}
			},
			want: func(issuer string) Endpoints {
				return Endpoints{
					Authorization: issuer + "/authorize",
					Token:         issuer + "/token",
					Userinfo:      issuer + "/userinfo",
					JWKS:          overrides.JWKSURI,
				}
			},
		},
		{
			name: "overriding every endpoint skips discovery",
			conn: func(issuer string) OIDCConnection {
				conn := overrides
				conn.Issuer = issuer
				return conn
			},
			want: func(string) Endpoints {
				return Endpoints{
					Authorization: overrides.AuthorizationEndpoint,
					Token:         overrides.TokenEndpoint,
					Userinfo:      overrides.UserinfoEndpoint,
					JWKS:          overrides.JWKSURI,
				}
			},
		},
		{
			name: "id_token mapping needs no userinfo endpoint",
			conn: func(issuer string) OIDCConnection {
				conn := overrides
				conn.Issuer = issuer
				conn.UserinfoEndpoint = ""
				conn.IDTokenMapping = true
				return conn
			},
			want: func(string) Endpoints {
				return Endpoints{
					Authorization: overrides.AuthorizationEndpoint,
					Token:         overrides.TokenEndpoint,
					JWKS:          overrides.JWKSURI,
				}
			},
		},
		{
			name: "a discovery issuer that differs from the configured one is rejected",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"issuer":"https://other.example.test"}`))
			},
			conn:      func(issuer string) OIDCConnection { return OIDCConnection{Issuer: issuer} },
			wantErr:   domain.ErrIDPDiscoveryFailed(nil),
			wantCause: oidc.ErrIssuerInvalid,
		},
		{
			name: "a document missing a needed endpoint is rejected",
			handler: func(w http.ResponseWriter, r *http.Request) {
				issuer := "http://" + r.Host
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"issuer":"` + issuer + `","authorization_endpoint":"` + issuer + `/authorize"}`))
			},
			conn:         func(issuer string) OIDCConnection { return OIDCConnection{Issuer: issuer} },
			wantErr:      domain.ErrIDPDiscoveryFailed(nil),
			wantCauseMsg: "missing token_endpoint in discovery",
		},
		{
			name: "an unparseable discovery document fails discovery",
			handler: func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte("<html>not json</html>"))
			},
			conn:      func(issuer string) OIDCConnection { return OIDCConnection{Issuer: issuer} },
			wantErr:   domain.ErrIDPDiscoveryFailed(nil),
			wantCause: oidc.ErrDiscoveryFailed,
		},
		{
			name: "a discovery timeout fails discovery",
			handler: func(w http.ResponseWriter, r *http.Request) {
				<-r.Context().Done()
			},
			conn:      func(issuer string) OIDCConnection { return OIDCConnection{Issuer: issuer} },
			timeout:   50 * time.Millisecond,
			wantErr:   domain.ErrIDPDiscoveryFailed(nil),
			wantCause: context.DeadlineExceeded,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := tt.handler
			if handler == nil {
				handler = func(w http.ResponseWriter, r *http.Request) {
					t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
				}
			}
			srv := httptest.NewServer(handler)
			t.Cleanup(srv.Close)
			conn := tt.conn(srv.URL)
			conn.ClientID = "client"
			conn.Scopes = []string{"openid"}

			ctx := context.Background()
			if tt.timeout > 0 {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, tt.timeout)
				t.Cleanup(cancel)
			}

			c, err := NewOIDCClient(ctx, conn, redirectURI, srv.Client())

			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				// The user-facing text is the generic message; the cause
				// stays in the log-only parent.
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
			want := tt.want(srv.URL)
			assert.Equal(t, want, c.Endpoints())
			config := c.RelyingParty().OAuthConfig()
			assert.Equal(t, want.Authorization, config.Endpoint.AuthURL)
			assert.Equal(t, want.Token, config.Endpoint.TokenURL)
			assert.Equal(t, "client", config.ClientID)
			assert.Equal(t, redirectURI, config.RedirectURL)
			assert.Equal(t, []string{"openid"}, config.Scopes)
		})
	}
}

func TestSigningAlgorithms(t *testing.T) {
	assert.Equal(t, []string{"RS256", "ES256", "PS256"}, SigningAlgorithms())
}
