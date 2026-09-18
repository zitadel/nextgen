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

// tokenHandler serves the token endpoint. check inspects the request after
// the handler has asserted the marker and the grant.
func tokenHandler(t *testing.T, check func(t *testing.T, r *http.Request)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/token", r.URL.Path)
		require.Equal(t, "tagged", r.Header.Get("X-Egress"), "request bypassed the egress client")
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
		// handler serves the provider; nil fails the test on any request.
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
			handler := tt.handler
			if handler == nil {
				handler = func(w http.ResponseWriter, r *http.Request) {
					t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
				}
			}
			srv := httptest.NewServer(handler)
			t.Cleanup(srv.Close)
			client := &http.Client{Transport: taggedTransport{next: srv.Client().Transport}}
			conn := Connection{RevisionID: "idprev_1", OIDC: OIDCConnection{
				Issuer:                  srv.URL,
				ClientID:                "client",
				Scopes:                  []string{"openid"},
				TokenEndpointAuthMethod: tt.authMethod,
				PKCEEnabled:             tt.pkce,
				AuthorizationEndpoint:   srv.URL + "/authorize",
				TokenEndpoint:           srv.URL + "/token",
				JWKSURI:                 srv.URL + "/keys",
				IDTokenMapping:          true,
			}}
			c, err := NewOIDCClient(context.Background(), conn, redirectURI, client)
			require.NoError(t, err)

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
