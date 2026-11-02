package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	oasapi "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/securityheaders"
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

func newTestMux(t *testing.T, cfg ServerConfig) http.Handler {
	t.Helper()
	mux, err := buildHTTPMux(cfg, idgen.NewULID(), doubleServers(t, echo), idpCallbackEcho(),
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

func get(t *testing.T, mux http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	return serve(t, mux, http.MethodGet, path)
}

func serve(t *testing.T, mux http.Handler, method, path string) *httptest.ResponseRecorder {
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

	// With the console off, its prefix is not a mount at all.
	assert.Equal(t, "root", get(t, mux, "/ui/console/").Header().Get("X-Test-Handler"))
}

// A job's trigger is a mount only when a scheduler outside the process runs
// the job; otherwise its path is the API's like any other. It takes the
// request ID the proxy sent, so the scheduler's log and the server's lines
// name the same run.
func TestBuildHTTPMuxMountsTheJobTriggersOnlyWhenGiven(t *testing.T) {
	cfg := ServerConfig{RequestIDHeader: "x-vercel-id"}
	trigger := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-Test-Handler", "retention-trigger")
	})
	mux, err := buildHTTPMux(cfg, idgen.NewULID(), doubleServers(t, echo), idpCallbackEcho(),
		staticResolver(consoleRuntime{Mode: ConsoleModeStandalone}, nil),
		nil, map[string]http.Handler{audit.RetentionTriggerPath: trigger, audit.UsageTriggerPath: nil})
	require.NoError(t, err)

	r := httptest.NewRequest(http.MethodGet, audit.RetentionTriggerPath, nil)
	r.Header.Set("x-vercel-id", "fra1::2vxlh-1792820352212-3ce3eb4ad630")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, r)
	assert.Equal(t, "retention-trigger", rec.Header().Get("X-Test-Handler"))
	assert.Equal(t, "2vxlh-1792820352212-3ce3eb4ad630", rec.Header().Get("X-Request-Id"))
	// A longer path is not the trigger and stays with the API's root alias.
	assert.Equal(t, "root", get(t, mux, audit.RetentionTriggerPath+"/x").Header().Get("X-Test-Handler"))
	assert.Equal(t, "root", get(t, mux, audit.UsageTriggerPath).Header().Get("X-Test-Handler"),
		"a job no trigger runs leaves its path to the API's root alias")

	assert.Equal(t, "root", get(t, newTestMux(t, cfg), audit.RetentionTriggerPath).Header().Get("X-Test-Handler"),
		"without a trigger the path falls through to the API's root alias")
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
		nil, nil)
	require.NoError(t, err)

	for _, path := range []string{"/api/v1/teams", "/teams", "/livez"} {
		rec := serve(t, mux, http.MethodPost, path)
		require.Equal(t, http.StatusTeapot, rec.Code, "%s must reach the API", path)
	}
	assert.Equal(t, map[string]bool{"api": true, "root": true, "probes": true}, recorded,
		"api.WithCSRFRequest must wrap every mount of the API")
}

// The generated reader knows only __Host-zitadel_session. A browser on a
// loopback http server holds zitadel_session, which reaches it only through
// api.WithLoopbackSessionCookie, and only after api.WithRequestHostMiddleware
// has said the request is loopback http; pinned so neither can drop out of
// the chain or swap places unnoticed.
func TestBuildHTTPMuxHandsTheAPITheLoopbackSessionCookie(t *testing.T) {
	t.Parallel()
	var found string
	mux, err := buildHTTPMux(uiConfig(false), idgen.NewULID(),
		doubleServers(t, func(string) http.HandlerFunc {
			return func(w http.ResponseWriter, r *http.Request) {
				found = ""
				if cookie, err := r.Cookie("__Host-zitadel_session"); err == nil {
					found = cookie.Value
				}
				w.WriteHeader(http.StatusTeapot)
			}
		}),
		idpCallbackEcho(),
		staticResolver(consoleRuntime{Mode: ConsoleModeStandalone, ConsoleProjectID: "proj_first"}, nil),
		nil, nil)
	require.NoError(t, err)

	// Under the prefix and at the root alias (ADR 077).
	for _, path := range []string{"/api/v1/sessions/me", "/sessions/me"} {
		loopback := httptest.NewRequest(http.MethodGet, "http://localhost:8080"+path, nil)
		loopback.Header.Set("Cookie", "zitadel_session=tok")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, loopback)
		require.Equal(t, http.StatusTeapot, rec.Code, "%s must reach the API handler", path)
		assert.Equal(t, "tok", found, "loopback http hands the API the loopback cookie at %s", path)

		forwarded := httptest.NewRequest(http.MethodGet, "http://localhost:8080"+path, nil)
		forwarded.Header.Set("X-Forwarded-Proto", "https")
		forwarded.Header.Set("Cookie", "zitadel_session=tok")
		mux.ServeHTTP(httptest.NewRecorder(), forwarded)
		assert.Empty(t, found, "https leaves the loopback cookie unread at %s", path)
	}
}

// Every response carries the security headers, and each surface its own
// policy: the console the pair its page needs, everything else the policy of
// a response that is no page.
func TestBuildHTTPMuxSendsTheSecurityHeaders(t *testing.T) {
	requireEmbeddedUI(t)
	mux := newTestMux(t, uiConfig(true))

	for _, path := range []string{"/ui/console/", "/ui/console/assets/missing.js", "/api/v1/users", "/users", consoleRuntimePath} {
		header := get(t, mux, path).Header()
		assert.Equal(t, "nosniff", header.Get("X-Content-Type-Options"), path)
		assert.Equal(t, "strict-origin-when-cross-origin", header.Get("Referrer-Policy"), path)
		assert.Equal(t, "DENY", header.Get("X-Frame-Options"), path)
		assert.Contains(t, header.Get(securityheaders.PolicyHeader), "frame-ancestors 'none'", path)
	}

	console := get(t, mux, "/ui/console/").Header()
	assert.Contains(t, console.Get(securityheaders.PolicyHeader), "script-src 'self' 'sha256-")
	assert.Contains(t, console.Get(securityheaders.ReportOnlyPolicyHeader), "default-src 'self'")
	api := get(t, mux, "/users").Header()
	assert.Equal(t, "default-src 'none'; frame-ancestors 'none'", api.Get(securityheaders.PolicyHeader))
	assert.Empty(t, api.Get(securityheaders.ReportOnlyPolicyHeader))
}

// Browsers post policy violations without a session or the CSRF token, so
// the report path is a mount of its own, ahead of the API.
func TestBuildHTTPMuxTakesPolicyReports(t *testing.T) {
	mux := newTestMux(t, uiConfig(false))

	r := httptest.NewRequest(http.MethodPost, securityheaders.ReportPath,
		strings.NewReader(`{"csp-report":{"effective-directive":"script-src-elem","blocked-uri":"inline"}}`))
	r.Header.Set("Content-Type", "application/csp-report")
	r.Header.Set("Sec-Fetch-Site", "same-origin")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, r)

	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Empty(t, rec.Header().Get("X-Test-Handler"))
}
