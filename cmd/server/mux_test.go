package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/staticui/console"
	"github.com/zitadel/nextgen/internal/storage/dialect/idgen"
)

// The mux's routing table is a cross-surface contract: the embedded console is
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
// console:build, so a missing dist means the tree was built wrong, not that
// this case is inapplicable.
func requireEmbeddedUI(t *testing.T) {
	t.Helper()
	require.NoError(t, console.ValidateDist(), "run `moon run console:build`")
}

func idpCallbackEcho() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-Test-Handler", "idp-callback")
		w.WriteHeader(http.StatusTeapot)
	})
}

func newTestMux(t *testing.T, cfg ServerConfig) *http.ServeMux {
	t.Helper()
	mux, err := buildHTTPMux(cfg, idgen.NewULID(), apiEcho(), idpCallbackEcho(),
		staticResolver(consoleRuntime{Mode: ConsoleModeStandalone, ConsoleProjectID: "proj_first"}, nil),
		nil, nil)
	require.NoError(t, err)
	return mux
}

func uiConfig(consoleEnabled bool) ServerConfig {
	return ServerConfig{
		ConsoleEnabled: consoleEnabled,
		ConsolePath:    "/ui/console",
	}
}

func get(t *testing.T, mux *http.ServeMux, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestBuildHTTPMuxServesTheConsoleAndTheAPIAtRoot(t *testing.T) {
	requireEmbeddedUI(t)
	mux := newTestMux(t, uiConfig(true))

	rec := get(t, mux, "/ui/console/")
	assert.Equal(t, http.StatusOK, rec.Code, "the console should be served by its static handler")
	assert.Empty(t, rec.Header().Get("X-Test-Handler"), "the console must not reach the API handler")

	// The server serves no login page of its own: the customer's app does.
	assert.Equal(t, "api", get(t, mux, "/ui/login/").Header().Get("X-Test-Handler"))

	rec = get(t, mux, consoleRuntimePath)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"mode":"standalone","console_project_id":"proj_first"}`, rec.Body.String())
}

// The API is mounted at the root and nowhere else. `/api/flow` is the base the
// embedded console used to call: it reaches the API handler, but as the
// literal path `/api/flow`, which is not an operation — hence the 404 in the
// shipped build. Restoring an `/api` shim would break this case, deliberately.
func TestBuildHTTPMuxDoesNotMountTheAPIUnderAPIPrefix(t *testing.T) {
	requireEmbeddedUI(t)
	mux := newTestMux(t, uiConfig(true))

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

// The IdP callback is mounted per connection ahead of the API catch-all: the
// provider redirects the browser to it, so it must exist whatever UI surfaces
// are on. Both spellings are served: the prefixed path when the instance is
// the browser origin, the stripped one as a scaffolded app's SDK proxy
// forwards it.
func TestBuildHTTPMuxMountsTheIDPCallback(t *testing.T) {
	mux := newTestMux(t, uiConfig(false))

	for _, path := range []string{api.IDPCallbackPath("google"), api.IDPCallbackUpstreamPath("google")} {
		rec := get(t, mux, path+"?state=s&code=c")
		assert.Equal(t, "idp-callback", rec.Header().Get("X-Test-Handler"), path)
		// A longer path is not the callback and stays with the API namespace.
		assert.Equal(t, "api", get(t, mux, path+"/x").Header().Get("X-Test-Handler"), path)
	}
}

// The shared callback that preceded the per-connection routes is not mounted:
// a callback that names no connection is the shape the mix-up attack relies on
// (RFC 9700 §4.4). It falls through to the API, which does not process it.
func TestBuildHTTPMuxServesNoSharedIDPCallback(t *testing.T) {
	mux := newTestMux(t, uiConfig(false))

	for _, path := range []string{"/__nextgen/idp/callback", "/idp/callback"} {
		assert.Equal(t, "api", get(t, mux, path+"?state=s&code=c").Header().Get("X-Test-Handler"), path)
	}
}

// slugRecorder is the callback's service half, recording what the handler
// read from the request.
type slugRecorder struct{ in service.FlowSSOCallbackInput }

func (s *slugRecorder) Process(_ context.Context, in service.FlowSSOCallbackInput) (service.FlowSSOCallbackOutput, error) {
	s.in = in
	return service.FlowSSOCallbackOutput{ReturnTarget: "https://app.example.com/login"}, nil
}

// The real handler behind the production chain: a middleware that rebuilt the
// request would drop the path wildcard, and every callback would then fail the
// connection check.
func TestBuildHTTPMuxHandsTheCallbackItsConnectionSlug(t *testing.T) {
	for _, path := range []string{api.IDPCallbackPath("google"), api.IDPCallbackUpstreamPath("google")} {
		recorder := &slugRecorder{}
		mux, err := buildHTTPMux(uiConfig(false), idgen.NewULID(), apiEcho(), api.NewIDPCallbackHandler(recorder),
			staticResolver(consoleRuntime{Mode: ConsoleModeStandalone, ConsoleProjectID: "proj_first"}, nil),
			nil, nil)
		require.NoError(t, err)

		rec := get(t, mux, path+"?state=s&code=c")
		require.Equal(t, http.StatusSeeOther, rec.Code, path)
		assert.Equal(t, "google", recorder.in.ConnectionSlug, path)
	}
}

// A console served elsewhere still discovers its project from this server:
// the hosted cloud runs the console as a service of its own, and the console's
// dev server proxies the document. So a deployment with its own console off
// must still serve it.
func TestBuildHTTPMuxServesRuntimeDocumentWithTheConsoleOff(t *testing.T) {
	mux := newTestMux(t, uiConfig(false))

	rec := get(t, mux, consoleRuntimePath)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Empty(t, rec.Header().Get("X-Test-Handler"), "runtime document must not fall through to the API")
	assert.JSONEq(t, `{"mode":"standalone","console_project_id":"proj_first"}`, rec.Body.String())
	assert.NotEmpty(t, rec.Header().Get("X-Request-Id"), "the runtime document takes the request ID and the request line")

	// With the console off, its prefix is not a mount at all.
	assert.Equal(t, "api", get(t, mux, "/ui/console/").Header().Get("X-Test-Handler"))
}

// The event retention trigger is a mount only when a scheduler outside the
// process runs the purge; otherwise its path is the API's like any other. It
// takes the request ID the proxy sent, so the scheduler's log and the
// server's lines name the same run.
func TestBuildHTTPMuxMountsTheRetentionTriggerOnlyWhenGiven(t *testing.T) {
	cfg := ServerConfig{RequestIDHeader: "x-vercel-id"}
	trigger := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-Test-Handler", "retention-trigger")
	})
	mux, err := buildHTTPMux(cfg, idgen.NewULID(), apiEcho(), idpCallbackEcho(),
		staticResolver(consoleRuntime{Mode: ConsoleModeStandalone}, nil),
		nil, trigger)
	require.NoError(t, err)

	r := httptest.NewRequest(http.MethodGet, audit.RetentionTriggerPath, nil)
	r.Header.Set("x-vercel-id", "fra1::2vxlh-1792820352212-3ce3eb4ad630")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, r)
	assert.Equal(t, "retention-trigger", rec.Header().Get("X-Test-Handler"))
	assert.Equal(t, "2vxlh-1792820352212-3ce3eb4ad630", rec.Header().Get("X-Request-Id"))
	// A longer path is not the trigger and stays with the API namespace.
	assert.Equal(t, "api", get(t, mux, audit.RetentionTriggerPath+"/x").Header().Get("X-Test-Handler"))

	assert.Equal(t, "api", get(t, newTestMux(t, cfg), audit.RetentionTriggerPath).Header().Get("X-Test-Handler"),
		"without a trigger the path falls through to the API")
}

// checkSessionCSRF refuses every cookie-authenticated request that did not pass
// through api.WithCSRFRequest, so a mux without it would lock the Console out;
// pinned here so a refactor of the chain cannot drop it unnoticed.
func TestBuildHTTPMuxRecordsCSRFRequestState(t *testing.T) {
	t.Parallel()
	recorded := false
	mux, err := buildHTTPMux(uiConfig(false), idgen.NewULID(),
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			recorded = api.CSRFRequestRecorded(r.Context())
			w.WriteHeader(http.StatusTeapot)
		}),
		idpCallbackEcho(),
		staticResolver(consoleRuntime{Mode: ConsoleModeStandalone, ConsoleProjectID: "proj_first"}, nil),
		nil, nil)
	require.NoError(t, err)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/teams", nil))
	require.Equal(t, http.StatusTeapot, rec.Code, "the request must reach the API handler")
	require.True(t, recorded, "api.WithCSRFRequest must wrap the API handler")
}
