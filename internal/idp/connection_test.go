package idp

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestParseConnection(t *testing.T) {
	tests := []struct {
		name string
		body string
		want Connection
		// wantErr is the domain kind; wantCauseMsg pins the log-only cause.
		wantErr      error
		wantCauseMsg string
	}{
		{
			name: "defaults fill an omitted auth method, pkce flag, and subject claim",
			body: `{
				"slug": "google",
				"protocol": "oidc",
				"display_name": "Google",
				"oidc": {
					"issuer": "https://accounts.example.test",
					"client_id": "client",
					"client_secret": "${{ GOOGLE_SECRET }}",
					"scopes": ["openid", "email"]
				}
			}`,
			want: Connection{
				RevisionID:   "idprev_1",
				SubjectClaim: "sub",
				OIDC: OIDCConnection{
					Issuer:                  "https://accounts.example.test",
					ClientID:                "client",
					ClientSecretRef:         "${{ GOOGLE_SECRET }}",
					TokenEndpointAuthMethod: ClientSecretBasic,
					Scopes:                  []string{"openid", "email"},
					PKCEEnabled:             true,
				},
			},
		},
		{
			name: "explicit values win over the defaults",
			body: `{
				"slug": "entra",
				"protocol": "oidc",
				"display_name": "Entra",
				"subject_claim": "oid",
				"oidc": {
					"issuer": "https://accounts.example.test",
					"jwks_uri": "https://accounts.example.test/keys",
					"id_token_mapping": true,
					"authorization_endpoint": "https://accounts.example.test/authorize",
					"token_endpoint": "https://accounts.example.test/token",
					"userinfo_endpoint": "https://accounts.example.test/userinfo",
					"client_id": "client",
					"client_secret": "${{ ENTRA_SECRET }}",
					"token_endpoint_auth_method": "client_secret_post",
					"scopes": ["openid", "email"],
					"pkce_enabled": false,
					"static_authorize_parameters": {"prompt": "select_account"}
				}
			}`,
			want: Connection{
				RevisionID:   "idprev_1",
				SubjectClaim: "oid",
				OIDC: OIDCConnection{
					Issuer:                    "https://accounts.example.test",
					ClientID:                  "client",
					ClientSecretRef:           "${{ ENTRA_SECRET }}",
					TokenEndpointAuthMethod:   ClientSecretPost,
					Scopes:                    []string{"openid", "email"},
					PKCEEnabled:               false,
					StaticAuthorizeParameters: map[string]string{"prompt": "select_account"},
					AuthorizationEndpoint:     "https://accounts.example.test/authorize",
					TokenEndpoint:             "https://accounts.example.test/token",
					UserinfoEndpoint:          "https://accounts.example.test/userinfo",
					JWKSURI:                   "https://accounts.example.test/keys",
					IDTokenMapping:            true,
				},
			},
		},
		{
			name: "a local development endpoint may use http",
			body: `{
				"slug": "local",
				"protocol": "oidc",
				"display_name": "Local",
				"oidc": {
					"issuer": "http://localhost:8080",
					"token_endpoint": "http://127.0.0.1:8080/token",
					"client_id": "client",
					"client_secret": "${{ LOCAL_SECRET }}",
					"scopes": ["openid"]
				}
			}`,
			want: Connection{
				RevisionID:   "idprev_1",
				SubjectClaim: "sub",
				OIDC: OIDCConnection{
					Issuer:                  "http://localhost:8080",
					ClientID:                "client",
					ClientSecretRef:         "${{ LOCAL_SECRET }}",
					TokenEndpointAuthMethod: ClientSecretBasic,
					Scopes:                  []string{"openid"},
					PKCEEnabled:             true,
					TokenEndpoint:           "http://127.0.0.1:8080/token",
				},
			},
		},
		{
			name: "a missing protocol block is rejected",
			body: `{
				"slug": "google",
				"protocol": "oidc",
				"display_name": "Google"
			}`,
			wantErr:      domain.ErrIDPProtocolBlockMissing(nil),
			wantCauseMsg: "protocol is oidc but the oidc block is absent",
		},
		{
			name: "scopes without openid are rejected",
			body: `{
				"slug": "google",
				"protocol": "oidc",
				"display_name": "Google",
				"oidc": {
					"issuer": "https://accounts.example.test",
					"client_id": "client",
					"client_secret": "${{ GOOGLE_SECRET }}",
					"scopes": ["email"]
				}
			}`,
			wantErr: domain.ErrIDPScopesMissingOpenID(),
		},
		{
			name: "an http endpoint on a non-local host is rejected",
			body: `{
				"slug": "google",
				"protocol": "oidc",
				"display_name": "Google",
				"oidc": {
					"issuer": "https://accounts.example.test",
					"token_endpoint": "http://accounts.example.test/token",
					"client_id": "client",
					"client_secret": "${{ GOOGLE_SECRET }}",
					"scopes": ["openid"]
				}
			}`,
			wantErr:      domain.ErrIDPEndpointCleartext(nil),
			wantCauseMsg: "token_endpoint is not an https endpoint",
		},
		{
			name: "an oauth2 body is refused",
			body: `{
				"slug": "github",
				"protocol": "oauth2",
				"display_name": "GitHub",
				"subject_claim": "id",
				"oauth2": {
					"authorization_endpoint": "https://github.example.test/login/oauth/authorize",
					"token_endpoint": "https://github.example.test/login/oauth/access_token",
					"userinfo_endpoint": "https://api.github.example.test/user",
					"client_id": "client",
					"client_secret": "${{ GITHUB_SECRET }}"
				}
			}`,
			wantErr: domain.ErrIDPOAuth2Unsupported(),
		},
		{
			name:         "an undecodable body is an internal error",
			body:         "{",
			wantErr:      domain.ErrInternal(nil),
			wantCauseMsg: "decode connection revision: unexpected end of JSON input",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseConnection("idprev_1", []byte(tt.body))

			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				assert.Equal(t, tt.wantErr.Error(), err.Error())
				if tt.wantCauseMsg != "" {
					de, ok := errors.AsType[domain.Error](err)
					require.True(t, ok)
					assert.EqualError(t, de.Parent, tt.wantCauseMsg)
				}
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}
