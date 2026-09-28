package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

const (
	oidcConnection = `{"slug":"google","protocol":"oidc","display_name":"Google",
		"oidc":{"issuer":"https://accounts.google.com","client_id":"id","client_secret":"${{ S }}","scopes":["openid"]}}`
	oauth2Connection = `{"slug":"github","protocol":"oauth2","display_name":"GitHub","subject_claim":"id",
		"oauth2":{"authorization_endpoint":"https://github.com/login/oauth/authorize",
		"token_endpoint":"https://github.com/login/oauth/access_token",
		"userinfo_endpoint":"https://api.github.com/user","client_id":"id","client_secret":"${{ S }}"}}`
)

func TestIDPConnectionImmutableFieldsChanged(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		stored string
		next   string
		want   []string
	}{
		{
			name:   "an unchanged identity reports nothing",
			stored: oidcConnection,
			next: `{"slug":"google","protocol":"oidc","display_name":"Renamed",
				"oidc":{"issuer":"https://accounts.google.com","client_id":"other","client_secret":"${{ T }}","scopes":["openid","email"]}}`,
		},
		{
			name:   "a new oidc issuer is reported",
			stored: oidcConnection,
			next: `{"slug":"google","protocol":"oidc","display_name":"Google",
				"oidc":{"issuer":"https://evil.example.com","client_id":"id","client_secret":"${{ S }}","scopes":["openid"]}}`,
			want: []string{"oidc.issuer"},
		},
		{
			name:   "setting a subject claim that was absent is a change",
			stored: oidcConnection,
			next: `{"slug":"google","protocol":"oidc","display_name":"Google","subject_claim":"sub",
				"oidc":{"issuer":"https://accounts.google.com","client_id":"id","client_secret":"${{ S }}","scopes":["openid"]}}`,
			want: []string{"subject_claim"},
		},
		{
			name:   "both oauth2 endpoints are reported together",
			stored: oauth2Connection,
			next: `{"slug":"github","protocol":"oauth2","display_name":"GitHub","subject_claim":"id",
				"oauth2":{"authorization_endpoint":"https://github.com/login/oauth/authorize",
				"token_endpoint":"https://other.example.com/token",
				"userinfo_endpoint":"https://other.example.com/user","client_id":"id","client_secret":"${{ S }}"}}`,
			want: []string{"oauth2.token_endpoint", "oauth2.userinfo_endpoint"},
		},
		{
			name:   "a protocol change still compares subject_claim",
			stored: oidcConnection,
			next:   `{"slug":"google","protocol":"oauth2","display_name":"Google","subject_claim":"id","oauth2":{"token_endpoint":"https://x.example.com"}}`,
			want:   []string{"protocol", "subject_claim"},
		},
		{
			name:   "a protocol change skips the endpoints",
			stored: oauth2Connection,
			next:   `{"slug":"github","protocol":"oidc","display_name":"GitHub","subject_claim":"id","oidc":{"issuer":"https://x.example.com"}}`,
			want:   []string{"protocol"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := domain.IDPConnectionImmutableFieldsChanged([]byte(tt.stored), []byte(tt.next))
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}

	t.Run("an invalid document is an error", func(t *testing.T) {
		t.Parallel()
		_, err := domain.IDPConnectionImmutableFieldsChanged([]byte(oidcConnection), []byte(`{`))
		assert.Error(t, err)
	})
}
