package oauth

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPlatformAppResource(t *testing.T) {
	app := PlatformApp("https://api.example.com/", Config{})
	cli, ok := app.client(CLIClientID)
	require.True(t, ok)
	thirdParty := Client{ID: "https://mcp-client.example/metadata.json", Source: SourceMetadataDocument}

	tests := []struct {
		name      string
		client    Client
		requested string
		want      string
		ok        bool
	}{
		{"the CLI's default is the platform API", cli, "", "https://api.example.com", true},
		{"the CLI may name the MCP server", cli, "https://api.example.com/mcp", "https://api.example.com/mcp", true},
		{"a third party's default is the MCP server", thirdParty, "", "https://api.example.com/mcp", true},
		{"a third party may not name the platform API", thirdParty, "https://api.example.com", "", false},
		{"nobody may name an API the app does not serve", cli, "https://other.example.com", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			api, ok := app.resource(tt.client, tt.requested)
			assert.Equal(t, tt.ok, ok)
			assert.Equal(t, tt.want, api.Identifier)
		})
	}
}

func TestGrantedScopes(t *testing.T) {
	api := API{Scopes: []string{"orders.read"}}
	assert.Equal(t,
		[]string{"openid", "offline_access", "orders.read"},
		grantedScopes(api, []string{"openid", "offline_access", "orders.read", "orders.write", "openid"}),
		"unknown scopes drop out and repeats collapse (RFC 6749 §3.3)")
	assert.Nil(t, grantedScopes(api, nil))
}
