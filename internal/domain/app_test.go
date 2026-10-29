package domain_test

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// shopApp is a declared app with a web client, a service client, an API and
// an MCP server open to registration.
const shopApp = `{
  "slug": "shop", "name": "Shop",
  "clients": [
    {"slug": "web", "type": "confidential", "secret": "${{ WEB_SECRET }}",
     "grants": ["authorization_code", "refresh_token"],
     "redirect_uris": ["https://shop.example.com/callback", "http://127.0.0.1/callback"],
     "apis": [{"api": "orders"}, {"api": "billing/invoices", "scopes": ["invoices.read"]}]},
    {"slug": "repricer", "type": "confidential", "secret": "${{ REPRICER_SECRET }}",
     "grants": ["client_credentials"],
     "apis": [{"api": "orders", "scopes": ["orders.write"]}]},
    {"slug": "ios", "type": "public", "grants": ["authorization_code", "refresh_token"],
     "redirect_uris": ["com.example.shop:/callback"], "apis": [{"api": "orders"}]}
  ],
  "apis": [
    {"slug": "orders", "identifier": "https://api.shop.example.com",
     "scopes": [{"name": "orders.read", "description": "Read your orders"}, {"name": "orders.write"}]},
    {"slug": "mcp", "identifier": "https://shop.example.com/mcp", "third_party": true,
     "scopes": [{"name": "orders.read"}]}
  ],
  "registration": {"client_id_metadata_documents": true}
}`

func parseApp(t *testing.T, raw string) domain.AppDocument {
	t.Helper()
	doc, err := domain.ParseAppDocument([]byte(raw))
	require.NoError(t, err)
	return doc
}

// violations returns the paths Validate reports, or nil when it passes.
func violations(t *testing.T, doc domain.AppDocument, source domain.AppSource) []string {
	t.Helper()
	err := doc.Validate(source)
	if err == nil {
		return nil
	}
	require.ErrorIs(t, err, domain.ErrAppInvalid(nil))
	var de domain.Error
	require.True(t, errors.As(err, &de))
	details := de.Details.(map[string]any)
	var paths []string
	for _, v := range details["violations"].([]domain.AppViolation) {
		paths = append(paths, v.Path)
	}
	return paths
}

func TestAppDocumentValidate_AcceptsTheShop(t *testing.T) {
	t.Parallel()
	assert.Nil(t, violations(t, parseApp(t, shopApp), domain.AppSourceDeclared))
}

func TestAppDocumentValidate(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		app    string
		source domain.AppSource
		want   []string
	}{
		{
			name: "a slug names one config across clients and APIs",
			app: `{"slug":"a","name":"A",
				"clients":[{"slug":"api","type":"public","grants":["authorization_code"],"redirect_uris":["https://a.example/cb"]}],
				"apis":[{"slug":"api","identifier":"https://a.example/api"}]}`,
			want: []string{"/apis/0/slug"},
		},
		{
			name: "an API may not define a built-in scope or one scope twice",
			app: `{"slug":"a","name":"A","apis":[{"slug":"x","identifier":"https://x.example",
				"scopes":[{"name":"openid"},{"name":"x.read"},{"name":"x.read"}]}]}`,
			want: []string{"/apis/0/scopes/0/name", "/apis/0/scopes/2/name"},
		},
		{
			name: "two APIs of one app may not share an identifier",
			app: `{"slug":"a","name":"A","apis":[{"slug":"x","identifier":"https://x.example"},
				{"slug":"y","identifier":"https://x.example"}]}`,
			want: []string{"/apis/1/identifier"},
		},
		{
			name: "an identifier is https, loopback http or a urn, without a fragment",
			app: `{"slug":"a","name":"A","apis":[
				{"slug":"a","identifier":"http://api.example.com"},
				{"slug":"b","identifier":"http://localhost:8080/api"},
				{"slug":"c","identifier":"https://api.example.com/#x"},
				{"slug":"d","identifier":"urn:shop:orders"},
				{"slug":"e","identifier":"urn:orders"}]}`,
			want: []string{"/apis/0/identifier", "/apis/2/identifier", "/apis/4/identifier"},
		},
		{
			name: "a client's own API must exist and define the scopes it lists",
			app: `{"slug":"a","name":"A",
				"clients":[{"slug":"c","type":"public","grants":["authorization_code"],"redirect_uris":["https://a.example/cb"],
				  "apis":[{"api":"missing"},{"api":"x","scopes":["x.read","x.nope"]},{"api":"other/y"}]}],
				"apis":[{"slug":"x","identifier":"https://x.example","scopes":[{"name":"x.read"}]}]}`,
			want: []string{"/clients/0/apis/0/api", "/clients/0/apis/1/scopes/1"},
		},
		{
			name: "authorization_code needs a redirect URI, refresh_token needs authorization_code",
			app: `{"slug":"a","name":"A","clients":[
				{"slug":"c","type":"public","grants":["authorization_code"]},
				{"slug":"d","type":"confidential","secret":"${{ D }}","grants":["client_credentials","refresh_token"]}]}`,
			want: []string{"/clients/0/redirect_uris", "/clients/1/grants"},
		},
		{
			name: "redirect URIs: https, loopback http, canonical, no fragment, private-use only for public clients",
			app: `{"slug":"a","name":"A","clients":[
				{"slug":"c","type":"confidential","secret":"${{ C }}","grants":["authorization_code"],"redirect_uris":[
				  "https://a.example/cb","http://a.example/cb","http://[::1]:9000/cb","https://a.example/cb#x",
				  "HTTPS://a.example/cb","com.example.app:/cb"]}]}`,
			want: []string{"/clients/0/redirect_uris/1", "/clients/0/redirect_uris/3", "/clients/0/redirect_uris/4", "/clients/0/redirect_uris/5"},
		},
		{
			name: "a public client holds no secret and does not act as itself; a confidential one authenticates",
			app: `{"slug":"a","name":"A","clients":[
				{"slug":"p","type":"public","auth_method":"client_secret_basic","secret":"${{ P }}",
				 "grants":["authorization_code","client_credentials"],"redirect_uris":["https://a.example/cb"]},
				{"slug":"c","type":"confidential","auth_method":"none","secret":"${{ C }}","grants":["client_credentials"]}]}`,
			want: []string{"/clients/0/auth_method", "/clients/0/secret", "/clients/0/grants", "/clients/1/auth_method"},
		},
		{
			name: "a private_key_jwt client needs keys and no secret; keys are for private_key_jwt alone",
			app: `{"slug":"a","name":"A","clients":[
				{"slug":"k","type":"confidential","auth_method":"private_key_jwt","grants":["client_credentials"]},
				{"slug":"s","type":"confidential","auth_method":"private_key_jwt","secret":"${{ S }}",
				 "jwks":{"keys":[{"kty":"OKP","crv":"Ed25519","x":"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}]},"grants":["client_credentials"]},
				{"slug":"j","type":"confidential","secret":"${{ J }}","jwks":{"keys":[{"kty":"OKP"}]},"grants":["client_credentials"]},
				{"slug":"d","type":"confidential","auth_method":"private_key_jwt","grants":["client_credentials"],
				 "jwks":{"keys":[{"kty":"OKP","kid":"1"},{"kty":"OKP","kid":"1"}]}},
				{"slug":"ok","type":"confidential","auth_method":"private_key_jwt","grants":["client_credentials"],
				 "jwks":{"keys":[{"kty":"OKP","kid":"1"},{"kty":"OKP","kid":"2"}]}}]}`,
			want: []string{"/clients/0/jwks", "/clients/1/secret", "/clients/2/jwks", "/clients/3/jwks"},
		},
		{
			name:   "only a first-party client may skip consent",
			app:    `{"slug":"a","name":"A","clients":[{"slug":"c","type":"public","consent":"skip","grants":["authorization_code"],"redirect_uris":["https://a.example/cb"]}]}`,
			source: domain.AppSourceRegistered,
			want:   []string{"/clients/0/consent"},
		},
		{
			name: "a chosen client_id may not look minted",
			app: `{"slug":"a","name":"A","clients":[{"slug":"c","client_id":"client_01ABC","type":"public",
				"grants":["authorization_code"],"redirect_uris":["https://a.example/cb"]}]}`,
			want: []string{"/clients/0/client_id"},
		},
		{
			name:   "a declared confidential client needs its secret reference",
			app:    `{"slug":"a","name":"A","clients":[{"slug":"c","type":"confidential","grants":["client_credentials"]}]}`,
			source: domain.AppSourceDeclared,
			want:   []string{"/clients/0/secret"},
		},
		{
			name:   "a registered app holds no secret reference",
			app:    `{"slug":"a","name":"A","clients":[{"slug":"c","type":"confidential","secret":"${{ C }}","grants":["client_credentials"]}]}`,
			source: domain.AppSourceRegistered,
			want:   []string{"/clients/0/secret"},
		},
		{
			name:   "a registered confidential client needs no reference",
			app:    `{"slug":"a","name":"A","clients":[{"slug":"c","type":"confidential","grants":["client_credentials"]}]}`,
			source: domain.AppSourceRegistered,
		},
		{
			name: "registration needs an API open to third parties",
			app: `{"slug":"a","name":"A","apis":[{"slug":"x","identifier":"https://x.example"}],
				"registration":{"dynamic":true}}`,
			want: []string{"/registration"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			source := tt.source
			if source == "" {
				source = domain.AppSourceDeclared
			}
			assert.Equal(t, tt.want, violations(t, parseApp(t, tt.app), source))
		})
	}
}

func TestAppClientDefaults(t *testing.T) {
	t.Parallel()

	doc := parseApp(t, shopApp)
	web, _ := doc.Client("web")
	ios, _ := doc.Client("ios")

	assert.Equal(t, domain.ClientAuthClientSecretBasic, web.EffectiveAuthMethod())
	assert.Equal(t, domain.ClientAuthNone, ios.EffectiveAuthMethod())

	assert.True(t, web.IsFirstParty(domain.AppSourceDeclared))
	assert.True(t, web.IsFirstParty(domain.AppSourceBuiltin))
	assert.False(t, web.IsFirstParty(domain.AppSourceRegistered))
	assert.Equal(t, domain.ConsentSkip, web.EffectiveConsent(domain.AppSourceDeclared))
	assert.Equal(t, domain.ConsentNewScopes, web.EffectiveConsent(domain.AppSourceRegistered))
	no := false
	web.FirstParty = &no
	assert.False(t, web.IsFirstParty(domain.AppSourceDeclared))
	web.Consent = domain.ConsentAlways
	assert.Equal(t, domain.ConsentAlways, web.EffectiveConsent(domain.AppSourceDeclared))
}

func TestResolvedAppAccessTo(t *testing.T) {
	t.Parallel()

	shop := &domain.ResolvedApp{Slug: "shop", Source: domain.AppSourceDeclared, Document: parseApp(t, shopApp)}
	billing := &domain.ResolvedApp{Slug: "billing", Source: domain.AppSourceRegistered, Document: parseApp(t, `{
		"slug":"billing","name":"Billing","apis":[{"slug":"invoices","identifier":"https://billing.example",
		"scopes":[{"name":"invoices.read"},{"name":"invoices.write"}]}]}`)}
	orders, _ := shop.Document.APIByIdentifier("https://api.shop.example.com")
	mcp, _ := shop.Document.APIByIdentifier("https://shop.example.com/mcp")
	invoices, _ := billing.Document.APIByIdentifier("https://billing.example")
	web, _ := shop.Document.Client("web")
	repricer, _ := shop.Document.Client("repricer")

	t.Run("a client's own API by slug, every scope when it lists none", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, domain.ClientAPIAccess{Allowed: true, Scopes: []string{"orders.read", "orders.write"}},
			shop.AccessTo(web, shop, orders))
	})
	t.Run("only the scopes a client lists", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, domain.ClientAPIAccess{Allowed: true, Scopes: []string{"orders.write"}},
			shop.AccessTo(repricer, shop, orders))
	})
	t.Run("another app's API as <app>/<api>", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, domain.ClientAPIAccess{Allowed: true, Scopes: []string{"invoices.read"}},
			shop.AccessTo(web, billing, invoices))
		assert.False(t, shop.AccessTo(repricer, billing, invoices).Allowed)
	})
	t.Run("an API the client does not list", func(t *testing.T) {
		t.Parallel()
		assert.False(t, shop.AccessTo(web, shop, mcp).Allowed)
	})
	t.Run("a registered client only reaches third_party APIs", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, domain.ClientAPIAccess{Allowed: true, Scopes: []string{"orders.read"}},
			shop.AccessTo(domain.AppClient{}, shop, mcp))
		assert.False(t, shop.AccessTo(domain.AppClient{}, shop, orders).Allowed)
	})
}

func TestGrantScopes(t *testing.T) {
	t.Parallel()

	orders, _ := parseApp(t, shopApp).APIByIdentifier("https://api.shop.example.com")
	writeOnly := domain.ClientAPIAccess{Allowed: true, Scopes: []string{"orders.write"}}

	t.Run("built-in and allowed scopes, in request order, once each", func(t *testing.T) {
		t.Parallel()
		granted, err := domain.GrantScopes(orders, writeOnly, []string{"openid", "orders.write", "offline_access", "openid"})
		require.NoError(t, err)
		assert.Equal(t, []string{"openid", "orders.write", "offline_access"}, granted)
	})
	t.Run("an unknown scope is refused, never dropped", func(t *testing.T) {
		t.Parallel()
		_, err := domain.GrantScopes(orders, writeOnly,
			[]string{"openid", "urn:zitadel:iam:org:project:id:123:aud"})
		require.ErrorIs(t, err, domain.ErrInvalidScope(nil))
		var de domain.Error
		require.True(t, errors.As(err, &de))
		assert.Equal(t, map[string][]string{"unknown": {"urn:zitadel:iam:org:project:id:123:aud"}}, de.Details)
	})
	t.Run("a scope the API defines but the client may not get is refused", func(t *testing.T) {
		t.Parallel()
		_, err := domain.GrantScopes(orders, writeOnly, []string{"orders.read"})
		require.ErrorIs(t, err, domain.ErrInvalidScope(nil))
		var de domain.Error
		require.True(t, errors.As(err, &de))
		assert.Equal(t, map[string][]string{"not_allowed": {"orders.read"}}, de.Details)
	})
}
