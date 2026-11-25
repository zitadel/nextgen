package api_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"

	"go.zitadel.com/zitadel/v5/api"
)

// The spec's servers URL is the contract (ADR 077), and PathPrefix what the
// server mounts the API under and the clients call; the server's
// apps/api/api/client and @zitadel/api's API_PREFIX have the same test. A
// change to one alone would leave the others behind.
//
// The spec lives in the monorepo, beside the server module. Outside it (a
// consumer's `go test all` over the module cache) there is nothing to hold
// the constant against, so the test skips; inside it a missing spec fails.
func TestPathPrefixIsTheSpecsServerURL(t *testing.T) {
	t.Parallel()
	serverModule := filepath.Join("..", "..", "..", "apps", "api")
	if _, err := os.Stat(filepath.Join(serverModule, "go.mod")); err != nil {
		t.Skipf("outside the monorepo (%v): no spec to check against", err)
	}
	raw, err := os.ReadFile(filepath.Join(serverModule, "api", "openapi", "openapi-spec.yaml"))
	require.NoError(t, err)
	var spec struct {
		Servers []struct {
			URL string `yaml:"url"`
		} `yaml:"servers"`
	}
	require.NoError(t, yaml.Unmarshal(raw, &spec))
	require.NotEmpty(t, spec.Servers)
	assert.Equal(t, spec.Servers[0].URL, api.PathPrefix)
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
		assert.Equal(t, want, api.BaseURL(origin), origin)
	}
}

// The generated client puts an operation's path after its base URL's own.
func TestNewCallsTheAPIUnderThePrefix(t *testing.T) {
	t.Parallel()
	var path string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("ok"))
	}))
	t.Cleanup(srv.Close)

	c, err := api.New(srv.URL, nil, api.WithClient(srv.Client()))
	require.NoError(t, err)
	_, err = c.GetLive(t.Context())
	require.NoError(t, err)
	assert.Equal(t, "/api/v1/livez", path)
}
