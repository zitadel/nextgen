package oauth

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/zitadel/oidc/v3/pkg/oidc"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestNewClient(t *testing.T) {
	const (
		loopback      = "http://127.0.0.1:3000/callback"
		loopbackQuery = "http://127.0.0.1:3000/query-callback?app=1"
		web           = "https://app.example.com/callback"
	)
	tests := []struct {
		name      string
		requested string
		// admitted says the requested URI joins the registered ones.
		admitted bool
	}{
		{name: "exact_match_is_not_added_twice", requested: loopback},
		{name: "loopback_on_other_port", requested: "http://127.0.0.1:4000/callback", admitted: true},
		{name: "loopback_without_port", requested: "http://127.0.0.1/callback", admitted: true},
		{name: "other_loopback_host", requested: "http://localhost:4000/callback"},
		{name: "other_path", requested: "http://127.0.0.1:4000/other"},
		{name: "loopback_with_query_on_other_port", requested: "http://127.0.0.1:4000/query-callback?app=1", admitted: true},
		{name: "other_query", requested: "http://127.0.0.1:4000/query-callback?app=2"},
		{name: "fragment", requested: "http://127.0.0.1:4000/callback#x"},
		{name: "trailing_question_mark", requested: "http://127.0.0.1:4000/callback?"},
		{name: "https_scheme", requested: "https://127.0.0.1:4000/callback"},
		{name: "userinfo_hides_host", requested: "http://127.0.0.1:1@evil.example/callback"},
		{name: "not_canonical", requested: "HTTP://127.0.0.1:4000/callback"},
		// The port rule is for loopback only.
		{name: "web_on_other_port", requested: "https://app.example.com:8443/callback"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newClient("client_1", domain.ApplicationClientDocument{
				GrantTypes:   []string{"authorization_code", "refresh_token"},
				RedirectURIs: []string{loopback, loopbackQuery, web},
			}, tt.requested)

			want := []string{loopback, loopbackQuery, web}
			if tt.admitted {
				want = append(want, tt.requested)
			}
			assert.Equal(t, want, c.RedirectURIs())
			assert.Equal(t, "client_1", c.GetID())
			assert.Equal(t, []oidc.GrantType{oidc.GrantTypeCode, oidc.GrantTypeRefreshToken}, c.GrantTypes())
		})
	}
}
