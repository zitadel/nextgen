package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	oasapi "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/staticui/console"
	"github.com/zitadel/nextgen/internal/storage/dialect/idgen"
)

// The mux's routing table is a cross-surface contract: the embedded console is
// built against the paths it mounts, and nothing in a TypeScript build fails
// when they disagree. The console shipped calling `/api/*` — a path this mux
// had never served — because that disagreement had no test on either side.
//
// These cases pin the whole table, including the fallthrough: whatever is not
// one of the named mounts reaches the API's root alias with its path intact.
// Add a mount here when you add one to buildHTTPMux.

// apiDouble stands in for a generated server: it routes as one, through a
// real server on UnimplementedHandler, and hands the request to serve.
type apiDouble struct {
	*oasapi.Server
	serve http.HandlerFunc
}

func (d apiDouble) ServeHTTP(w http.ResponseWriter, r *http.Request) { d.serve(w, r) }

// doubleServers are the API's mounts as doubles that route as the real
// servers do, each handing its requests to serve with its mount's name.
func doubleServers(t *testing.T, serve func(mount string) http.HandlerFunc) api.Servers {
	t.Helper()
	servers, err := api.NewServers(oasapi.UnimplementedHandler{}, api.NewSecurityHandler(nil))
	require.NoError(t, err)
	double := func(server api.Router, mount string) api.Router {
		return apiDouble{Server: server.(*oasapi.Server), serve: serve(mount)}
	}
	return api.Servers{
		API:    double(servers.API, "api"),
		Probes: double(servers.Probes, "probes"),
		Root:   double(servers.Root, "root"),
	}
}

// echo reports the mount that served a request and the path it received, so
// a case can tell the mounts apart and catch a rewrite on the way.
func echo(mount string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Test-Handler", mount)
		w.Header().Set("X-Test-Path", r.URL.Path)
		w.WriteHeader(http.StatusTeapot)
	}
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
	mux, err := buildHTTPMux(cfg, idgen.NewULID(), doubleServers(t, echo), idpCallbackEcho(),
		staticResolver(consoleRuntime{Mode: ConsoleModeStandalone, ConsoleProjectID: "proj_first"}, nil),
		nil)
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
	return serve(t, mux, http.MethodGet, path)
}

func serve(t *testing.T, mux *http.ServeMux, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

func TestBuildHTTPMuxServesTheConsoleBesideTheAPI(t *testing.T) {
	requireEmbeddedUI(t)
	mux := newTestMux(t, uiConfig(true))

	rec := get(t, mux, "/ui/console/")
	assert.Equal(t, http.StatusOK, rec.Code, "the console should be served by its static handler")
	assert.Empty(t, rec.Header().Get("X-Test-Handler"), "the console must not reach the API")

	// The server serves no login page of its own: the customer's app does.
	assert.Equal(t, "root", get(t, mux, "/ui/login/").Header().Get("X-Test-Handler"))

	rec = get(t, mux, consoleRuntimePath)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"mode":"standalone","console_project_id":"proj_first"}`, rec.Body.String())
}

// The API answers under /api/v1, and until 1.0.0 at the root, where a
// response for an operation says it is deprecated (ADR 077). The probes
// answer at the root for good. `/api/flow` is the base the embedded console
// once called: under no prefix the API serves, it is no operation of the root
// alias either, and stays a 404.
func TestBuildHTTPMuxRoutesThePrefixTheProbesAndTheRootAlias(t *testing.T) {
	requireEmbeddedUI(t)
	mux := newTestMux(t, uiConfig(true))

	for _, tt := range []struct {
		method, path, mount string
		deprecated          bool
	}{
		{method: http.MethodGet, path: "/api/v1/users/me", mount: "api"},
		{method: http.MethodPost, path: "/api/v1/flow", mount: "api"},
		{method: http.MethodGet, path: "/api/v1/livez", mount: "api"},
		{method: http.MethodGet, path: "/api/v1", mount: "api"},
		{method: http.MethodGet, path: "/api/v1/", mount: "api"},
		{method: http.MethodGet, path: "/api/v1/nope", mount: "api"},
		{method: http.MethodOptions, path: "/api/v1/users/me", mount: "api"},

		{method: http.MethodGet, path: "/livez", mount: "probes"},
		{method: http.MethodGet, path: "/readyz", mount: "probes"},
		{method: http.MethodPost, path: "/livez", mount: "probes"},

		{method: http.MethodGet, path: "/users/me", mount: "root", deprecated: true},
		{method: http.MethodPost, path: "/flow", mount: "root", deprecated: true},
		{method: http.MethodGet, path: "/sessions/me", mount: "root", deprecated: true},
		{method: http.MethodOptions, path: "/users/me", mount: "root"},
		{method: http.MethodPost, path: "/sessions/me/csrf", mount: "root"},
		{method: http.MethodGet, path: "/nope", mount: "root"},
		{method: http.MethodGet, path: "/livez/", mount: "root"},
		{method: http.MethodGet, path: "/api/flow", mount: "root"},
		{method: http.MethodGet, path: "/api/v2/users/me", mount: "root"},
	} {
		name := tt.method + " " + tt.path
		rec := serve(t, mux, tt.method, tt.path)
		assert.Equal(t, tt.mount, rec.Header().Get("X-Test-Handler"), name)
		assert.Equal(t, tt.path, rec.Header().Get("X-Test-Path"), "%s must reach its mount unrewritten", name)
		assert.Equal(t, tt.deprecated, rec.Header().Get("Deprecation") != "", "%s: Deprecation", name)
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
		assert.Empty(t, rec.Header().Get("Deprecation"), path)
		// A longer path is not the callback and stays with the API namespace.
		assert.Equal(t, "root", get(t, mux, path+"/x").Header().Get("X-Test-Handler"), path)
	}
}

// The shared callback that preceded the per-connection routes is not mounted:
// a callback that names no connection is the shape the mix-up attack relies on
// (RFC 9700 §4.4). It falls through to the API, which does not process it.
func TestBuildHTTPMuxServesNoSharedIDPCallback(t *testing.T) {
	mux := newTestMux(t, uiConfig(false))

	for _, path := range []string{"/__nextgen/idp/callback", "/idp/callback"} {
		assert.Equal(t, "root", get(t, mux, path+"?state=s&code=c").Header().Get("X-Test-Handler"), path)
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
		mux, err := buildHTTPMux(uiConfig(false), idgen.NewULID(), doubleServers(t, echo), api.NewIDPCallbackHandler(recorder),
			staticResolver(consoleRuntime{Mode: ConsoleModeStandalone, ConsoleProjectID: "proj_first"}, nil),
			nil)
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

	// With the console off, its prefix is not a mount at all.
	assert.Equal(t, "root", get(t, mux, "/ui/console/").Header().Get("X-Test-Handler"))
}

// checkSessionCSRF refuses every cookie-authenticated request that did not pass
// through api.WithCSRFRequest, so a mux without it would lock the Console out;
// pinned here, on every mount, so a refactor of the chain cannot drop it
// unnoticed.
func TestBuildHTTPMuxRecordsCSRFRequestState(t *testing.T) {
	t.Parallel()
	recorded := map[string]bool{}
	mux, err := buildHTTPMux(uiConfig(false), idgen.NewULID(),
		doubleServers(t, func(mount string) http.HandlerFunc {
			return func(w http.ResponseWriter, r *http.Request) {
				recorded[mount] = api.CSRFRequestRecorded(r.Context())
				w.WriteHeader(http.StatusTeapot)
			}
		}),
		idpCallbackEcho(),
		staticResolver(consoleRuntime{Mode: ConsoleModeStandalone, ConsoleProjectID: "proj_first"}, nil),
		nil)
	require.NoError(t, err)

	for _, path := range []string{"/api/v1/teams", "/teams", "/livez"} {
		rec := serve(t, mux, http.MethodPost, path)
		require.Equal(t, http.StatusTeapot, rec.Code, "%s must reach the API", path)
	}
	assert.Equal(t, map[string]bool{"api": true, "root": true, "probes": true}, recorded,
		"api.WithCSRFRequest must wrap every mount of the API")
}
