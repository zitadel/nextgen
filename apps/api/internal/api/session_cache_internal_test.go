package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

// TestWithSessionStateNoStoreCoversTheSpec ties the middleware's hand-kept path
// list to the OpenAPI source: every GET that promises
// `Cache-Control: private, no-store` on an error response must get it from the
// middleware, because those errors (a missing cookie, a malformed request) are
// written before the operation handler runs and sets the header itself. A new
// session-state endpoint that is not added here fails this test instead of
// letting a 401 be cached.
func TestWithSessionStateNoStoreCoversTheSpec(t *testing.T) {
	t.Parallel()
	const openapiDir = "../../api/openapi"

	var spec struct {
		Paths map[string]struct {
			Ref string `yaml:"$ref"`
		} `yaml:"paths"`
	}
	raw, err := os.ReadFile(filepath.Join(openapiDir, "openapi-spec.yaml"))
	require.NoError(t, err)
	require.NoError(t, yaml.Unmarshal(raw, &spec))

	var covered []string
	for path, item := range spec.Paths {
		if item.Ref == "" {
			continue
		}
		var methods map[string]struct {
			Responses map[string]yaml.Node `yaml:"responses"`
		}
		raw, err := os.ReadFile(filepath.Join(openapiDir, item.Ref))
		require.NoError(t, err)
		require.NoError(t, yaml.Unmarshal(raw, &methods), item.Ref)

		get, ok := methods["get"]
		if !ok {
			continue
		}
		for status, response := range get.Responses {
			if strings.HasPrefix(status, "2") {
				continue // the handler sets it on success
			}
			out, err := yaml.Marshal(&response)
			require.NoError(t, err)
			if !strings.Contains(string(out), "cache-control-private-no-store.yaml") {
				continue
			}
			rec := httptest.NewRecorder()
			WithSessionStateNoStore(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).
				ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
			require.Equal(t, sessionStateCacheControl, rec.Header().Get("Cache-Control"),
				"GET %s promises no-store on %s; add it to WithSessionStateNoStore", path, status)
			covered = append(covered, path)
			break
		}
	}
	// The test must find something to check, or a moved spec file would turn it
	// into a silent pass.
	require.Contains(t, covered, "/sessions/me")
	require.Contains(t, covered, "/sessions/me/csrf")
}
