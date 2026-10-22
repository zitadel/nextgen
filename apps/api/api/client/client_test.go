package client_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"

	"github.com/zitadel/nextgen/api/client"
)

// The spec's servers URL is the contract (ADR 077), and PathPrefix what the
// server mounts the API under and the Go clients call; the public client's
// api.PathPrefix (packages/go) and @zitadel/api's API_PREFIX have the same
// test. A change to one alone would leave the others behind.
func TestPathPrefixIsTheSpecsServerURL(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile(filepath.Join("..", "openapi", "openapi-spec.yaml"))
	require.NoError(t, err)
	var spec struct {
		Servers []struct {
			URL string `yaml:"url"`
		} `yaml:"servers"`
	}
	require.NoError(t, yaml.Unmarshal(raw, &spec))
	require.NotEmpty(t, spec.Servers)
	assert.Equal(t, spec.Servers[0].URL, client.PathPrefix)
}

func TestBaseURL(t *testing.T) {
	t.Parallel()
	for origin, want := range map[string]string{
		"https://zitadel.example.com":         "https://zitadel.example.com/api/v1",
		"https://zitadel.example.com/":        "https://zitadel.example.com/api/v1",
		"http://localhost:8080":               "http://localhost:8080/api/v1",
		"https://example.com/zitadel":         "https://example.com/zitadel/api/v1",
		"https://zitadel.example.com/api/v1":  "https://zitadel.example.com/api/v1",
		"https://zitadel.example.com/api/v1/": "https://zitadel.example.com/api/v1",
	} {
		assert.Equal(t, want, client.BaseURL(origin), origin)
	}
}
