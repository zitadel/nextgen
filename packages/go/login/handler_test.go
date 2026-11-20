package login

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// browser is a client with a cookie jar that stops at every redirect, so a
// test sees each hop of the 303 chain.
func browser(t *testing.T) *http.Client {
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	return &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
}

// app mounts the login at /login on a test server over cfg and gives a
// browser for it, with get and post helpers that read each answer whole.
type app struct {
	*httptest.Server
	client *http.Client
	t      *testing.T
}

func newApp(t *testing.T, cfg Config) *app {
	mux := http.NewServeMux()
	require.NoError(t, Mount(mux, "/login", cfg))
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return &app{Server: server, client: browser(t), t: t}
}

func (a *app) get(path string) (*http.Response, string) {
	res, err := a.client.Get(a.URL + path)
	require.NoError(a.t, err)
	body, err := io.ReadAll(res.Body)
	require.NoError(a.t, err)
	require.NoError(a.t, res.Body.Close())
	return res, string(body)
}

func (a *app) post(path string, form url.Values) *http.Response {
	res, err := a.client.PostForm(a.URL+path, form)
	require.NoError(a.t, err)
	require.NoError(a.t, res.Body.Close())
	return res
}

func cookiesByName(res *http.Response) map[string]*http.Cookie {
	out := map[string]*http.Cookie{}
	for _, c := range res.Cookies() {
		out[c.Name] = c
	}
	return out
}

func TestHandlerPasswordLogin(t *testing.T) {
	api := newFakeAPI(t)
	cfg := testConfig(api.URL)
	cfg.PostSignInURL = "/app"
	app := newApp(t, cfg)

	// A first visit starts a flow and renders its identifier step.
	res, body := app.get("/login/")
	assert.Equal(t, http.StatusOK, res.StatusCode)
	assert.Equal(t, "text/html; charset=utf-8", res.Header.Get("Content-Type"))
	assert.Equal(t, "frame-ancestors 'none'", res.Header.Get("Content-Security-Policy"))
	assert.Contains(t, body, "<h1>Sign in</h1>")
	assert.Contains(t, body, `<form method="post" action="?flow=flow_1" class="step" data-step="identifier" novalidate>`)
	assert.Contains(t, body, `<input type="email" value="" autocomplete="username" data-testid="zitadel-input-email" name="email" required>`)
	assert.Contains(t, body, `<style>`)
	flowCookie := res.Cookies()[0]
	assert.Equal(t, FlowCookie, flowCookie.Name)
	assert.Equal(t, "sealed-1", flowCookie.Value)
	assert.Equal(t, "/login/", flowCookie.Path)
	assert.Equal(t, 600, flowCookie.MaxAge, "expires with the API's copy")
	assert.True(t, flowCookie.HttpOnly)
	assert.False(t, flowCookie.Secure, "plain http origin")

	// Submitting the identifier redirects back to the (next) step.
	res = app.post("/login/?flow=flow_1", url.Values{"action": {"submit"}, "email": {"a@example.com"}})
	assert.Equal(t, http.StatusSeeOther, res.StatusCode)
	assert.Equal(t, "/login/?flow=flow_1", res.Header.Get("Location"))
	assert.Equal(t, map[string]any{"email": "a@example.com"}, api.submits[0]["fields"])
	res, body = app.get("/login/?flow=flow_1")
	assert.Equal(t, http.StatusOK, res.StatusCode)
	assert.Contains(t, body, `data-step="password"`)
	assert.Contains(t, body, `<input type="password"`)

	// A refused password carries its error key to the re-rendered step.
	res = app.post("/login/?flow=flow_1", url.Values{"action": {"submit"}, "password": {"wrong"}})
	assert.Equal(t, "/login/?error=error.invalid_credentials&flow=flow_1", res.Header.Get("Location"))
	_, body = app.get(res.Header.Get("Location"))
	assert.Contains(t, body, `<p class="error" role="alert">Wrong email or password.</p>`)

	// The right one completes the flow: session cookie set, flow cookie
	// cleared, and off to the app.
	res = app.post("/login/?flow=flow_1", url.Values{"action": {"submit"}, "password": {"right"}})
	assert.Equal(t, http.StatusSeeOther, res.StatusCode)
	assert.Equal(t, "/app", res.Header.Get("Location"))
	assert.Equal(t, "private, no-store", res.Header.Get("Cache-Control"))
	cookies := cookiesByName(res)
	session := cookies["zitadel_session_proj_1"]
	require.NotNil(t, session, "session cookie under the SDKs' loopback name")
	assert.Equal(t, "zst_1", session.Value)
	assert.Equal(t, "/", session.Path)
	assert.Equal(t, 3600, session.MaxAge, "the API's session lifetime")
	assert.True(t, session.HttpOnly)
	assert.False(t, session.Secure)
	assert.Equal(t, http.SameSiteLaxMode, session.SameSite)
	assert.Less(t, cookies[FlowCookie].MaxAge, 0, "the flow cookie is cleared")
	loginURL, err := url.Parse(app.URL + "/login/")
	require.NoError(t, err)
	left := app.client.Jar.Cookies(loginURL)
	require.Len(t, left, 1, "only the session is left in the browser")
	assert.Equal(t, "zitadel_session_proj_1", left[0].Name)
}

func TestHandlerSecureOrigin(t *testing.T) {
	api := newFakeAPI(t)
	cfg := testConfig(api.URL)
	cfg.PublicOrigin = "https://app.example"
	app := newApp(t, cfg)

	res, _ := app.get("/login/")
	flowCookie := res.Cookies()[0]
	assert.Equal(t, "__Host-_zflow", flowCookie.Name)
	assert.Equal(t, "/", flowCookie.Path, "__Host- requires the root path")
	assert.True(t, flowCookie.Secure)
	// The jar is loopback http, so the Secure cookie must be carried by hand.
	req, err := http.NewRequest(http.MethodPost, app.URL+"/login/?flow=flow_1", strings.NewReader("action=submit&email=a%40example.com&password=right"))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.AddCookie(&http.Cookie{Name: "__Host-_zflow", Value: flowCookie.Value})
	res, err = app.client.Do(req)
	require.NoError(t, err)
	require.NoError(t, res.Body.Close())
	assert.Equal(t, http.StatusSeeOther, res.StatusCode)
	session := cookiesByName(res)["__Host-zitadel_session_proj_1"]
	require.NotNil(t, session)
	assert.True(t, session.Secure)
	assert.Equal(t, "/", session.Path)
}

func TestHandlerSSO(t *testing.T) {
	api := newFakeAPI(t)
	handler, err := Handler(testConfig(api.URL))
	require.NoError(t, err)
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	client := browser(t)

	res, err := client.Get(server.URL + "/")
	require.NoError(t, err)
	require.NoError(t, res.Body.Close())
	res, err = client.PostForm(server.URL+"/?flow=flow_1", url.Values{"action": {"sso"}, "sso_provider_id": {"idp_1"}})
	require.NoError(t, err)
	require.NoError(t, res.Body.Close())
	assert.Equal(t, http.StatusSeeOther, res.StatusCode)
	assert.Equal(t, "https://idp.example/authorize", res.Header.Get("Location"))
	assert.Equal(t, "http://localhost:3000/?flow=flow_1", api.submits[0]["return_target"], "the return target is on the public origin")
}

func TestHandlerErrorQuery(t *testing.T) {
	api := newFakeAPI(t)
	app := newApp(t, testConfig(api.URL))
	app.get("/login/")

	// Free text, or a key the API could not have sent, never reaches the page.
	_, body := app.get("/login/?flow=flow_1&error=Your+account+is+locked.+Call+%2B1-555-0100")
	assert.NotContains(t, body, "locked")
	assert.NotContains(t, body, `role="alert"`)
	_, body = app.get("/login/?flow=flow_1&error=error.phone_required")
	assert.NotContains(t, body, `role="alert"`, "a rule on a field the step does not render")
	// A rule on one of the step's fields and a catalog key both do.
	_, body = app.get("/login/?flow=flow_1&error=error.password_required%3B+error.outcome_unhandled")
	assert.Contains(t, body, `<p class="error" role="alert">Please enter a password</p>`)
	assert.Contains(t, body, `<p class="error" role="alert">This step could not continue. Please try again.</p>`)
}

func TestHandlerStepFailure(t *testing.T) {
	api := newFakeAPI(t)
	var logged strings.Builder
	cfg := testConfig(api.URL)
	cfg.Logger = slog.New(slog.NewTextHandler(&logged, nil))
	app := newApp(t, cfg)
	app.get("/login/")

	// A flow the API will not continue starts over: cookie cleared, back to
	// the bare route.
	api.getStatus = http.StatusUnauthorized
	res, _ := app.get("/login/?flow=flow_1")
	assert.Equal(t, http.StatusSeeOther, res.StatusCode)
	assert.Equal(t, "/login/", res.Header.Get("Location"))
	assert.Less(t, cookiesByName(res)[FlowCookie].MaxAge, 0)
	assert.Empty(t, logged.String(), "an expired flow is not a failure")

	// Any other failure keeps the flow, tells the browser only generically
	// and the log everything.
	app.get("/login/")
	api.getStatus = http.StatusInternalServerError
	res, body := app.get("/login/?flow=flow_1")
	assert.Equal(t, http.StatusBadGateway, res.StatusCode)
	assert.Equal(t, "We couldn't complete your sign in. Please try again in a few minutes\n", body)
	assert.Empty(t, res.Cookies(), "the flow is kept")
	assert.Contains(t, logged.String(), "enc_key.decrypt_failed")
	assert.NotContains(t, body, "enc_key")

	// A POST without the flow cookie starts over.
	res, err := browser(t).PostForm(app.URL+"/login/?flow=flow_1", url.Values{"action": {"submit"}})
	require.NoError(t, err)
	require.NoError(t, res.Body.Close())
	assert.Equal(t, http.StatusSeeOther, res.StatusCode)
	assert.Equal(t, "/login/", res.Header.Get("Location"))
}

func TestHandlerTerminalWithoutHandoff(t *testing.T) {
	api := newFakeAPI(t)
	api.noHandoff = true
	app := newApp(t, testConfig(api.URL))
	app.get("/login/")

	// Nobody to sign in: the terminal step is shown from the POST, since the
	// API answers a later read of it with 410, and the flow cookie goes.
	res, err := app.client.PostForm(app.URL+"/login/?flow=flow_1", url.Values{"action": {"submit"}, "password": {"x"}})
	require.NoError(t, err)
	body, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	require.NoError(t, res.Body.Close())
	assert.Equal(t, http.StatusOK, res.StatusCode)
	assert.Contains(t, string(body), `data-step="no-account"`)
	assert.Less(t, cookiesByName(res)[FlowCookie].MaxAge, 0)
	assert.Nil(t, cookiesByName(res)["zitadel_session_proj_1"])
}
