package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/staticui/console"
	"github.com/zitadel/nextgen/internal/staticui/login"
	"github.com/zitadel/nextgen/internal/storage/dialect/idgen"
)

// The mux's routing table is a cross-surface contract: the embedded SPAs are
// built against the paths it mounts, and nothing in a TypeScript build fails
// when they disagree. The console shipped calling `/api/*` — a path this mux
// has never served — because that disagreement had no test on either side.
//
// These cases pin the whole table, including the fallthrough: whatever is not
// one of the named mounts reaches the API handler with its path intact. Add a
// mount here when you add one to buildHTTPMux; a `/api` prefix strip is
// explicitly not one of them (Console ADR 0002 §1, revised).

// apiEcho stands in for the ogen handler and reports the path it received, so
// a case can tell "fell through to the API" from "was served by a mount" and
// catch a rewrite on the way.
func apiEcho() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Test-Handler", "api")
		w.Header().Set("X-Test-Path", r.URL.Path)
		w.WriteHeader(http.StatusTeapot)
	})
}

// requireEmbeddedUI fails rather than skips: `server:test` depends on
// console:build and login-ui:build, so a missing dist means the tree was
// built wrong, not that this case is inapplicable.
func requireEmbeddedUI(t *testing.T) {
	t.Helper()
	require.NoError(t, console.ValidateDist(), "run `moon run console:build`")
	require.NoError(t, login.ValidateDist(), "run `moon run login-ui:build`")
}

func newTestMux(t *testing.T, cfg ServerConfig) *http.ServeMux {
	t.Helper()
	mux, err := buildHTTPMux(cfg, idgen.NewULID(), apiEcho(),
		staticResolver(consoleRuntime{Mode: ConsoleModeStandalone, ConsoleProjectID: "proj_first"}, nil))
	require.NoError(t, err)
	return mux
}

func uiConfig(consoleEnabled, loginEnabled bool) ServerConfig {
	return ServerConfig{
		ConsoleEnabled: consoleEnabled,
		ConsolePath:    "/ui/console",
		LoginEnabled:   loginEnabled,
		LoginPath:      "/ui/login",
	}
}

func get(t *testing.T, mux *http.ServeMux, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestBuildHTTPMuxServesBothUISurfacesAndTheAPIAtRoot(t *testing.T) {
	requireEmbeddedUI(t)
	mux := newTestMux(t, uiConfig(true, true))

	for _, path := range []string{"/ui/console/", "/ui/login/"} {
		rec := get(t, mux, path)
		assert.Equal(t, http.StatusOK, rec.Code, "%s should be served by its static handler", path)
		assert.Empty(t, rec.Header().Get("X-Test-Handler"), "%s must not reach the API handler", path)
	}

	rec := get(t, mux, consoleRuntimePath)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"mode":"standalone","console_project_id":"proj_first"}`, rec.Body.String())
}

// The API is mounted at the root and nowhere else. `/api/flow` is the base the
// embedded console used to call: it reaches the API handler, but as the
// literal path `/api/flow`, which is not an operation — hence the 404 in the
// shipped build. Restoring an `/api` shim would break this case, deliberately.
func TestBuildHTTPMuxDoesNotMountTheAPIUnderAPIPrefix(t *testing.T) {
	requireEmbeddedUI(t)
	mux := newTestMux(t, uiConfig(true, true))

	for path, want := range map[string]string{
		"/flow":            "/flow",
		"/sessions/me":     "/sessions/me",
		"/api/flow":        "/api/flow",
		"/api/sessions/me": "/api/sessions/me",
	} {
		rec := get(t, mux, path)
		assert.Equal(t, "api", rec.Header().Get("X-Test-Handler"), "%s should reach the API handler", path)
		assert.Equal(t, want, rec.Header().Get("X-Test-Path"), "%s must reach the API handler unrewritten", path)
	}
}

// The runtime document is not console-only: the hosted login shell resolves
// the project it signs into from the same two fields, so a console-disabled
// deployment must still serve it.
func TestBuildHTTPMuxServesRuntimeDocumentForTheLoginSurfaceAlone(t *testing.T) {
	requireEmbeddedUI(t)
	mux := newTestMux(t, uiConfig(false, true))

	rec := get(t, mux, consoleRuntimePath)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Empty(t, rec.Header().Get("X-Test-Handler"), "runtime document must not fall through to the API")
	assert.JSONEq(t, `{"mode":"standalone","console_project_id":"proj_first"}`, rec.Body.String())

	// With the console off, its prefix is not a mount at all.
	assert.Equal(t, "api", get(t, mux, "/ui/console/").Header().Get("X-Test-Handler"))
}

// With neither surface enabled there is nothing to bootstrap, so the path
// carries no special meaning and belongs to the API's namespace like any
// other. (`console-e2e:e2e-real` runs in exactly this configuration.)
func TestBuildHTTPMuxOmitsRuntimeDocumentWhenNoUISurfaceIsEnabled(t *testing.T) {
	mux := newTestMux(t, uiConfig(false, false))

	rec := get(t, mux, consoleRuntimePath)
	assert.Equal(t, "api", rec.Header().Get("X-Test-Handler"))
	assert.Equal(t, consoleRuntimePath, rec.Header().Get("X-Test-Path"))
}
