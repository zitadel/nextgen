package domain_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// registrationViolations returns the paths Validate reports for metadata
// after its defaults, or nil when it passes.
func registrationViolations(t *testing.T, meta domain.ClientRegistrationMetadata) []string {
	t.Helper()
	err := meta.WithDefaults().Validate()
	if err == nil {
		return nil
	}
	require.ErrorIs(t, err, domain.ErrClientRegistrationInvalid(nil))
	var de domain.Error
	require.True(t, errors.As(err, &de))
	details := de.Details.(map[string]any)
	var paths []string
	for _, v := range details["violations"].([]domain.AppViolation) {
		paths = append(paths, v.Path)
	}
	return paths
}

func TestClientRegistrationMetadataDefaults(t *testing.T) {
	t.Parallel()

	meta := domain.ClientRegistrationMetadata{RedirectURIs: []string{"http://127.0.0.1:33418/callback"}}.WithDefaults()
	assert.Equal(t, domain.ClientAuthNone, meta.AuthMethod)
	assert.Equal(t, []domain.GrantType{domain.GrantAuthorizationCode, domain.GrantRefreshToken}, meta.GrantTypes)
	assert.Equal(t, domain.ClientTypePublic, meta.ClientType())
	assert.Nil(t, meta.Validate(), "an MCP client's minimal registration is valid")

	meta.AuthMethod = domain.ClientAuthClientSecretPost
	assert.Equal(t, domain.ClientTypeConfidential, meta.ClientType())
}

func TestClientRegistrationMetadataValidate(t *testing.T) {
	t.Parallel()

	loopback := []string{"http://127.0.0.1:33418/callback"}
	tests := []struct {
		name string
		meta domain.ClientRegistrationMetadata
		want []string
	}{
		{
			name: "display fields, software and a confidential web client",
			meta: domain.ClientRegistrationMetadata{
				ClientName: "Claude", ClientURI: "https://claude.ai", LogoURI: "https://claude.ai/logo.png",
				PolicyURI: "https://claude.ai/privacy", TOSURI: "https://claude.ai/terms",
				SoftwareID: "claude-code", SoftwareVersion: "2.1.0",
				RedirectURIs: []string{"https://claude.ai/api/mcp/auth_callback"},
				AuthMethod:   domain.ClientAuthClientSecretBasic,
			},
		},
		{
			name: "a native app's private-use scheme",
			meta: domain.ClientRegistrationMetadata{RedirectURIs: []string{"com.example.agent:/callback"}},
		},
		{
			name: "no redirect URI",
			meta: domain.ClientRegistrationMetadata{},
			want: []string{"/redirect_uris"},
		},
		{
			name: "too many redirect URIs",
			meta: domain.ClientRegistrationMetadata{RedirectURIs: []string{
				"https://a.example/1", "https://a.example/2", "https://a.example/3", "https://a.example/4",
				"https://a.example/5", "https://a.example/6", "https://a.example/7", "https://a.example/8",
				"https://a.example/9", "https://a.example/10", "https://a.example/11",
			}},
			want: []string{"/redirect_uris"},
		},
		{
			name: "redirect URIs a browser may not be sent to, or listed twice",
			meta: domain.ClientRegistrationMetadata{RedirectURIs: []string{
				"http://agent.example/callback", "https://agent.example/cb#frag", "javascript:alert(1)",
				"http://127.0.0.1:33418/callback", "http://127.0.0.1:33418/callback",
			}},
			want: []string{"/redirect_uris/0", "/redirect_uris/1", "/redirect_uris/2", "/redirect_uris/4"},
		},
		{
			name: "a private-use scheme on a client with a secret",
			meta: domain.ClientRegistrationMetadata{
				RedirectURIs: []string{"com.example.agent:/callback"},
				AuthMethod:   domain.ClientAuthClientSecretPost,
			},
			want: []string{"/redirect_uris/0"},
		},
		{
			name: "keys and machine grants are not for registered clients",
			meta: domain.ClientRegistrationMetadata{
				RedirectURIs: loopback,
				AuthMethod:   domain.ClientAuthPrivateKeyJWT,
				GrantTypes:   []domain.GrantType{domain.GrantClientCredentials, domain.GrantRefreshToken, domain.GrantRefreshToken},
			},
			want: []string{"/token_endpoint_auth_method", "/grant_types/0", "/grant_types/2", "/grant_types"},
		},
		{
			name: "display fields the consent step could not show safely",
			meta: domain.ClientRegistrationMetadata{
				ClientName:      "Claude\u202e",
				SoftwareID:      strings.Repeat("x", 257),
				SoftwareVersion: "2.1\n",
				ClientURI:       "http://claude.ai",
				LogoURI:         "https://user:pw@claude.ai/logo.png",
				PolicyURI:       "/privacy",
				RedirectURIs:    loopback,
			},
			want: []string{"/client_name", "/software_id", "/software_version", "/client_uri", "/logo_uri", "/policy_uri"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, registrationViolations(t, tt.meta))
		})
	}
}

func TestClientRegistrationAccessTo(t *testing.T) {
	t.Parallel()

	registration := &domain.ClientRegistration{ID: "dcr_1"}
	open := &domain.ResolvedApp{Slug: "shop", Document: parseApp(t, `{
		"slug":"shop","name":"Shop","registration":{"dynamic":true},"apis":[
		{"slug":"mcp","identifier":"https://shop.example.com/mcp","third_party":true,"scopes":[{"name":"orders.read"}]},
		{"slug":"orders","identifier":"https://api.shop.example.com","scopes":[{"name":"orders.write"}]}]}`)}
	closed := &domain.ResolvedApp{Slug: "shop", Document: parseApp(t, shopApp)}
	mcp, _ := open.Document.APIByIdentifier("https://shop.example.com/mcp")
	orders, _ := open.Document.APIByIdentifier("https://api.shop.example.com")
	closedMCP, _ := closed.Document.APIByIdentifier("https://shop.example.com/mcp")

	assert.Equal(t, domain.ClientAPIAccess{Allowed: true, Scopes: []string{"orders.read"}}, registration.AccessTo(open, mcp),
		"a third_party API of an app open to dynamic registration, every scope")
	assert.False(t, registration.AccessTo(open, orders).Allowed, "an API that is not third_party")
	assert.False(t, registration.AccessTo(closed, closedMCP).Allowed,
		"an app that opens client ID metadata documents only")
}

func TestAppDocumentValidate_RefusesMintedClientIDForms(t *testing.T) {
	t.Parallel()

	for _, id := range []string{"client_01KWH3B", "dcr_01KWH3B"} {
		doc := parseApp(t, `{"slug":"shop","name":"Shop","clients":[{"slug":"cli","client_id":"`+id+`",
			"type":"public","grants":["authorization_code"],"redirect_uris":["http://127.0.0.1/callback"]}]}`)
		assert.Equal(t, []string{"/clients/0/client_id"}, violations(t, doc, domain.AppSourceRegistered), id)
	}
}
