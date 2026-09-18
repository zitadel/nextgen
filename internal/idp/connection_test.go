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
		// wantErr is compared by code, message, and details; wantCauseMsg
		// pins the log-only parent.
		wantErr      *domain.Error
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
			name: "explicit values win over the defaults, and a verified_claims false is dropped",
			body: `{
				"slug": "entra",
				"protocol": "oidc",
				"display_name": "Entra",
				"subject_claim": "oid",
				"claim_mapping": {"email": "email", "givenName": "name"},
				"verified_claims": {"email": "email_verified", "givenName": true, "phone": "$supplementary_fetch", "familyName": false},
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
				ClaimMapping: map[string]string{"email": "email", "givenName": "name"},
				VerifiedClaims: map[string]VerificationSource{
					"email":     {Kind: VerifyByClaim, Claim: "email_verified"},
					"givenName": {Kind: VerifyByTrust},
					"phone":     {Kind: VerifyByStrategy},
				},
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
					"authorization_endpoint": "http://localhost:8080/authorize",
					"token_endpoint": "http://127.0.0.1:8080/token",
					"userinfo_endpoint": "http://localhost:8080/userinfo",
					"jwks_uri": "http://localhost:8080/keys",
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
					AuthorizationEndpoint:   "http://localhost:8080/authorize",
					TokenEndpoint:           "http://127.0.0.1:8080/token",
					UserinfoEndpoint:        "http://localhost:8080/userinfo",
					JWKSURI:                 "http://localhost:8080/keys",
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
			wantErr:      new(domain.ErrIDPProtocolBlockMissing("oidc")),
			wantCauseMsg: "oidc block is missing",
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
			wantErr: new(domain.ErrIDPScopesMissingOpenID()),
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
			wantErr:      new(domain.ErrIDPEndpointCleartext("token_endpoint")),
			wantCauseMsg: "token_endpoint is not https",
		},
		{
			name: "an issuer with a query string is rejected",
			body: `{
				"slug": "google",
				"protocol": "oidc",
				"display_name": "Google",
				"oidc": {
					"issuer": "https://accounts.example.test/?tenant=1",
					"client_id": "client",
					"client_secret": "${{ GOOGLE_SECRET }}",
					"scopes": ["openid"]
				}
			}`,
			wantErr:      new(domain.ErrIDPEndpointCleartext("issuer")),
			wantCauseMsg: "issuer is not https",
		},
		{
			name: "a partial endpoint set is rejected",
			body: `{
				"slug": "google",
				"protocol": "oidc",
				"display_name": "Google",
				"oidc": {
					"issuer": "https://accounts.example.test",
					"jwks_uri": "https://accounts.example.test/keys",
					"client_id": "client",
					"client_secret": "${{ GOOGLE_SECRET }}",
					"scopes": ["openid"]
				}
			}`,
			wantErr:      new(domain.ErrIDPEndpointsPartial([]string{"authorization_endpoint", "token_endpoint", "userinfo_endpoint"})),
			wantCauseMsg: "missing endpoints: authorization_endpoint, token_endpoint, userinfo_endpoint",
		},
		{
			name: "id_token mapping needs no userinfo endpoint in a full set",
			body: `{
				"slug": "custom",
				"protocol": "oidc",
				"display_name": "Custom",
				"oidc": {
					"issuer": "https://idp.example.test",
					"id_token_mapping": true,
					"authorization_endpoint": "https://idp.example.test/authorize",
					"token_endpoint": "https://idp.example.test/token",
					"jwks_uri": "https://idp.example.test/keys",
					"client_id": "client",
					"client_secret": "${{ CUSTOM_SECRET }}",
					"scopes": ["openid"]
				}
			}`,
			want: Connection{
				RevisionID:   "idprev_1",
				SubjectClaim: "sub",
				OIDC: OIDCConnection{
					Issuer:                  "https://idp.example.test",
					ClientID:                "client",
					ClientSecretRef:         "${{ CUSTOM_SECRET }}",
					TokenEndpointAuthMethod: ClientSecretBasic,
					Scopes:                  []string{"openid"},
					PKCEEnabled:             true,
					AuthorizationEndpoint:   "https://idp.example.test/authorize",
					TokenEndpoint:           "https://idp.example.test/token",
					JWKSURI:                 "https://idp.example.test/keys",
					IDTokenMapping:          true,
				},
			},
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
			wantErr: new(domain.ErrIDPOAuth2Unsupported()),
		},
		{
			name:         "an undecodable body is an internal error",
			body:         "{",
			wantErr:      new(domain.ErrInternal(nil)),
			wantCauseMsg: "decode connection revision: unexpected end of JSON input",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseConnection("idprev_1", []byte(tt.body))

			if tt.wantErr != nil {
				de, ok := errors.AsType[domain.Error](err)
				require.True(t, ok, "got %v", err)
				assert.Equal(t, tt.wantErr.Code, de.Code)
				assert.Equal(t, tt.wantErr.Message, de.Message)
				assert.Equal(t, tt.wantErr.Details, de.Details)
				if tt.wantCauseMsg != "" {
					assert.EqualError(t, de.Parent, tt.wantCauseMsg)
				}
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}
