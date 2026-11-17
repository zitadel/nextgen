package oauth

import (
	"bytes"
	"cmp"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

const (
	authorizePath = "/oauth/proj_123/authorize"
	callback      = "https://app.example.com/callback"
	// challenge is the S256 challenge of RFC 7636 appendix B.
	challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
)

// clients is a fake ClientResolver over a fixed set of documents.
type clients map[string]domain.ApplicationClientDocument

func (c clients) Client(_ context.Context, _, _, clientID string) (domain.ApplicationClientDocument, error) {
	doc, ok := c[clientID]
	if !ok {
		return domain.ApplicationClientDocument{}, domain.ErrApplicationNotFound()
	}
	return doc, nil
}

// failing is a ClientResolver whose lookup fails with err.
type failing struct{ err error }

func (f failing) Client(context.Context, string, string, string) (domain.ApplicationClientDocument, error) {
	return domain.ApplicationClientDocument{}, f.err
}

// authRequests is a fake AuthRequestStore that records what it stores.
type authRequests struct {
	stored []*domain.AuthRequest
	err    error
}

func (a *authRequests) Create(_ context.Context, request *domain.AuthRequest) (string, error) {
	if a.err != nil {
		return "", a.err
	}
	request.ID = "authreq_1"
	a.stored = append(a.stored, request)
	return "nonce", nil
}

var (
	deployed = settings{settings: Settings{Enabled: true, DeploymentID: "dep_1", ReleaseID: "rel_1"}}
	shop     = clients{
		"shop":     {GrantTypes: []string{"authorization_code"}, RedirectURIs: []string{callback, "http://127.0.0.1:3000/callback"}},
		"no-codes": {GrantTypes: []string{"client_credentials"}, RedirectURIs: []string{callback}},
	}
	browser = map[string]string{"X-Forwarded-Proto": "https", "Accept": "text/html"}
)

// authorizeQuery is a valid request of client shop, with set applied.
func authorizeQuery(set map[string]string) string {
	q := url.Values{
		"client_id":     {"shop"},
		"redirect_uri":  {callback},
		"response_type": {"code"},
		"state":         {"xyz"},
	}
	for k, v := range set {
		if v == "" {
			q.Del(k)
			continue
		}
		q.Set(k, v)
	}
	return "?" + q.Encode()
}

// A valid request from a registered client reaches the login page, with or
// without PKCE, stored with the deployment it was resolved from and bound
// to the browser by a cookie of its own. A browser at the cookie limit loses
// its oldest binding cookies.
func TestAuthorizeReachesTheLoginPage(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name          string
		set           map[string]string
		wantChallenge string
		wantState     string
		cookies       string
		wantExpired   []string
	}{
		{name: "without_pkce"},
		{name: "with_pkce", set: map[string]string{"code_challenge": challenge, "code_challenge_method": "S256"}, wantChallenge: challenge},
		{name: "state_at_limit", set: map[string]string{"state": strings.Repeat("s", 2048)}, wantState: strings.Repeat("s", 2048)},
		{name: "under_cookie_limit", cookies: "session=1; " + bindingCookieNames(9)},
		// Another cookie and a loopback binding cookie do not count.
		{name: "at_cookie_limit", cookies: "session=1; _zauth_authreq_x=n; " + bindingCookieNames(10), wantExpired: []string{"__Host-_zauth_authreq_00"}},
		{name: "over_cookie_limit", cookies: bindingCookieNames(12), wantExpired: []string{"__Host-_zauth_authreq_00", "__Host-_zauth_authreq_01", "__Host-_zauth_authreq_02"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			store := &authRequests{}
			mux := newMux(t, Config{Settings: deployed, Clients: shop, AuthRequests: store})
			headers := map[string]string{"X-Forwarded-Proto": "https", "Accept": "text/html", "Cookie": tt.cookies}

			rec := send(t, mux, http.MethodGet, authorizePath+authorizeQuery(tt.set), "app.example.com", headers)

			require.Equal(t, http.StatusFound, rec.Code, rec.Body.String())
			assert.Equal(t, "https://app.example.com/login?auth_request=authreq_1", rec.Header().Get("Location"))
			assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
			wantCookies := []string{"__Host-_zauth_authreq_1=nonce; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Lax"}
			for _, name := range tt.wantExpired {
				wantCookies = append(wantCookies, name+"=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax")
			}
			assert.Equal(t, wantCookies, rec.Header().Values("Set-Cookie"))
			require.Len(t, store.stored, 1)
			assert.Equal(t, &domain.AuthRequest{
				ProjectID:     "proj_123",
				ID:            "authreq_1",
				ClientID:      "shop",
				RedirectURI:   callback,
				State:         cmp.Or(tt.wantState, "xyz"),
				Scopes:        []string{},
				CodeChallenge: tt.wantChallenge,
				Issuer:        "https://app.example.com/oauth/proj_123",
				DeploymentID:  "dep_1",
				ReleaseID:     "rel_1",
			}, store.stored[0])
		})
	}
}

// A loopback issuer on plain http gets a cookie without the __Host- prefix,
// which a browser only accepts with Secure.
func TestAuthorizeOnLoopback(t *testing.T) {
	t.Parallel()
	store := &authRequests{}
	mux := newMux(t, Config{Settings: deployed, Clients: shop, AuthRequests: store})

	query := authorizeQuery(map[string]string{"redirect_uri": "http://127.0.0.1:3000/callback"})
	rec := send(t, mux, http.MethodGet, authorizePath+query, "localhost:8080", map[string]string{"Accept": "text/html"})

	require.Equal(t, http.StatusFound, rec.Code, rec.Body.String())
	assert.Equal(t, "http://localhost:8080/login?auth_request=authreq_1", rec.Header().Get("Location"))
	assert.Equal(t, "_zauth_authreq_1=nonce; Path=/; Max-Age=900; HttpOnly; SameSite=Lax", rec.Header().Get("Set-Cookie"))
	require.Len(t, store.stored, 1)
	assert.Equal(t, "http://127.0.0.1:3000/callback", store.stored[0].RedirectURI)
}

// A request without a scope is accepted. Until the server serves the
// standard scopes they are ignored, like any scope no client allows, so every
// request is stored with no scopes (ADR 082 §2).
func TestAuthorizeScopes(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		scope string
	}{
		{name: "none"},
		// The library lets this through today; a version that refuses it
		// like a missing scope turns this case red.
		{name: "only_spaces", scope: " "},
		{name: "custom", scope: "read"},
		{name: "openid", scope: "openid"},
		{name: "every_standard_scope", scope: "openid profile email address phone offline_access"},
		{name: "standard_and_custom", scope: "openid read"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			store := &authRequests{}
			mux := newMux(t, Config{Settings: deployed, Clients: shop, AuthRequests: store})

			rec := send(t, mux, http.MethodGet, authorizePath+authorizeQuery(map[string]string{"scope": tt.scope}), "app.example.com", browser)

			require.Equal(t, http.StatusFound, rec.Code, rec.Body.String())
			assert.Equal(t, "https://app.example.com/login?auth_request=authreq_1", rec.Header().Get("Location"))
			require.Len(t, store.stored, 1)
			assert.Empty(t, store.stored[0].Scopes)
		})
	}
}

func TestAuthorizeLoginPath(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name         string
		loginPath    string
		wantLocation string
	}{
		{name: "from_the_sdk_proxy", loginPath: "/auth/sign-in", wantLocation: "https://app.example.com/auth/sign-in?auth_request=authreq_1"},
		{name: "not_a_path", loginPath: "evil.example/login"},
		{name: "other_host", loginPath: "//evil.example/login"},
		{name: "with_query", loginPath: "/login?next=/"},
		{name: "trailing_question_mark", loginPath: "/login?"},
		{name: "with_fragment", loginPath: "/login#top"},
		// The shared check writes a '%' that starts no escape as "%25".
		{name: "lone_percent", loginPath: "/login%2", wantLocation: "https://app.example.com/login%252?auth_request=authreq_1"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			store := &authRequests{}
			mux := newMux(t, Config{Settings: deployed, Clients: shop, AuthRequests: store})
			headers := map[string]string{"X-Forwarded-Proto": "https", "Accept": "text/html", LoginPathHeader: tt.loginPath}

			rec := send(t, mux, http.MethodGet, authorizePath+authorizeQuery(nil), "app.example.com", headers)

			if tt.wantLocation == "" {
				assertErrorPage(t, rec, http.StatusBadRequest)
				assert.Empty(t, store.stored)
				return
			}
			require.Equal(t, http.StatusFound, rec.Code, rec.Body.String())
			assert.Equal(t, tt.wantLocation, rec.Header().Get("Location"))
		})
	}
}

// An invalid client or redirect URI shows the error page and never
// redirects; an issuer this server does not serve is a 404.
func TestAuthorizeShowsTheErrorPage(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		settings SettingsSource
		clients  ClientResolver
		set      map[string]string
		method   string
		// repeated is appended to the query as it is.
		repeated   string
		wantStatus int
	}{
		{name: "unknown_client", set: map[string]string{"client_id": "nobody"}, wantStatus: http.StatusBadRequest},
		// Refused before the lookup, which a database answers with an error.
		{name: "client_id_with_nul", clients: failing{errors.New("the database refuses the id")}, set: map[string]string{"client_id": "shop\x00"}, wantStatus: http.StatusBadRequest},
		{name: "client_id_not_utf8", clients: failing{errors.New("the database refuses the id")}, set: map[string]string{"client_id": "shop\xff"}, wantStatus: http.StatusBadRequest},
		{name: "unregistered_redirect_uri", set: map[string]string{"redirect_uri": "https://evil.example/callback"}, wantStatus: http.StatusBadRequest},
		// Any port is for native apps (ADR 082 §2), and every client is a web client.
		{name: "loopback_on_other_port", set: map[string]string{"redirect_uri": "http://127.0.0.1:4000/callback"}, wantStatus: http.StatusBadRequest},
		{name: "missing_redirect_uri", set: map[string]string{"redirect_uri": ""}, wantStatus: http.StatusBadRequest},
		{name: "clients_unavailable", clients: failing{domain.ErrUnavailable()}, wantStatus: http.StatusServiceUnavailable},
		{name: "clients_fail", clients: failing{errors.New("boom")}, wantStatus: http.StatusInternalServerError},
		{name: "oauth_off", settings: settings{}, wantStatus: http.StatusNotFound},
		{name: "settings_without_deployment", settings: settings{settings: Settings{Enabled: true, ReleaseID: "rel_1"}}, wantStatus: http.StatusInternalServerError},
		{name: "settings_without_release", settings: settings{settings: Settings{Enabled: true, DeploymentID: "dep_1"}}, wantStatus: http.StatusInternalServerError},
		{name: "settings_fail", settings: settings{err: domain.ErrInternal(errors.New("boom"))}, wantStatus: http.StatusInternalServerError},
		{name: "head", method: http.MethodHead, wantStatus: http.StatusBadRequest},
		{name: "repeated_client_id", repeated: "&client_id=shop", wantStatus: http.StatusBadRequest},
		{name: "repeated_redirect_uri", repeated: "&redirect_uri=https%3A%2F%2Fevil.example%2Fcallback", wantStatus: http.StatusBadRequest},
		{name: "repeated_state", repeated: "&state=xyz", wantStatus: http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if tt.settings == nil {
				tt.settings = deployed
			}
			if tt.clients == nil {
				tt.clients = shop
			}
			store := &authRequests{}
			mux := newMux(t, Config{Settings: tt.settings, Clients: tt.clients, AuthRequests: store})

			rec := send(t, mux, cmp.Or(tt.method, http.MethodGet), authorizePath+authorizeQuery(tt.set)+tt.repeated, "app.example.com", browser)

			assertErrorPage(t, rec, tt.wantStatus)
			assert.Empty(t, store.stored)
		})
	}
}

// The page of a refusal says what was refused.
func TestAuthorizeErrorPageSentence(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		set  map[string]string
		want string
	}{
		{name: "unknown_client", set: map[string]string{"client_id": "nobody"}, want: "unknown client"},
		{name: "unregistered_redirect_uri", set: map[string]string{"redirect_uri": "https://evil.example/callback"}, want: "redirect_uri"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			mux := newMux(t, Config{Settings: deployed, Clients: shop, AuthRequests: &authRequests{}})

			rec := send(t, mux, http.MethodGet, authorizePath+authorizeQuery(tt.set), "app.example.com", browser)

			assertErrorPage(t, rec, http.StatusBadRequest)
			assert.Contains(t, rec.Body.String(), tt.want)
		})
	}
}

// The other endpoints quote the request in their descriptions, so their
// pages show no sentence.
func TestErrorPageSentenceOnlyOnAuthorize(t *testing.T) {
	t.Parallel()
	mux := newMux(t, Config{Settings: deployed, Clients: shop, AuthRequests: &authRequests{}})

	rec := send(t, mux, http.MethodGet, "/oauth/proj_123/token?grant_type=quoted-value", "app.example.com", browser)

	assertErrorPage(t, rec, http.StatusBadRequest)
	assert.NotContains(t, rec.Body.String(), "quoted-value")
}

// Each error the endpoint answers gets one `api error` line, a fault at
// ERROR. The library logs the redirect it answers a refusal with, and the
// client's state in it stays out of the log.
func TestAuthorizeLogs(t *testing.T) {
	// Not parallel: the library logs through the default logger.
	tests := []struct {
		name      string
		clients   ClientResolver
		headers   map[string]string
		set       map[string]string
		wantLevel string
		// wantCause is in the api error line, wantLine anywhere in the log.
		wantCause string
		wantLine  string
	}{
		{name: "refusal", set: map[string]string{"prompt": "none", "state": "secret-state"}, wantLevel: "INFO", wantLine: "auth request redirect"},
		{name: "unknown_client", set: map[string]string{"client_id": "nobody"}, wantLevel: "INFO", wantCause: "unknown client"},
		// The library refuses these itself, between the server's two checks.
		{name: "unregistered_redirect_uri", set: map[string]string{"redirect_uri": "https://evil.example/callback"}, wantLevel: "INFO", wantCause: "redirect_uri is missing in the client configuration"},
		{name: "unregistered_redirect_uri_from_a_program", headers: https, set: map[string]string{"redirect_uri": "https://evil.example/callback"}, wantLevel: "INFO"},
		{name: "clients_fail", clients: failing{errors.New("boom")}, wantLevel: "ERROR", wantCause: "boom"},
		{name: "clients_unavailable", clients: failing{domain.ErrUnavailable()}, wantLevel: "ERROR"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var logs bytes.Buffer
			previous := slog.Default()
			t.Cleanup(func() { slog.SetDefault(previous) })
			slog.SetDefault(zlog.NewLogger(zlog.NewHandler(slog.LevelDebug, nil, slog.NewJSONHandler(&logs, nil))))
			if tt.clients == nil {
				tt.clients = shop
			}
			if tt.headers == nil {
				tt.headers = browser
			}
			mux := newMux(t, Config{Settings: deployed, Clients: tt.clients, AuthRequests: &authRequests{}})

			send(t, mux, http.MethodGet, authorizePath+authorizeQuery(tt.set), "app.example.com", tt.headers)

			var apiErrors []string
			for line := range strings.Lines(logs.String()) {
				if strings.Contains(line, `"msg":"api error"`) {
					apiErrors = append(apiErrors, line)
				}
			}
			require.Len(t, apiErrors, 1, logs.String())
			assert.Contains(t, apiErrors[0], `"level":"`+tt.wantLevel+`"`)
			assert.Contains(t, apiErrors[0], tt.wantCause)
			assert.Contains(t, logs.String(), tt.wantLine)
			assert.NotContains(t, logs.String(), "secret-state")
		})
	}
}

// A program gets the library's JSON, not the page.
func TestAuthorizeAnswersAProgramWithJSON(t *testing.T) {
	t.Parallel()
	mux := newMux(t, Config{Settings: deployed, Clients: shop, AuthRequests: &authRequests{}})

	rec := send(t, mux, http.MethodGet, authorizePath+authorizeQuery(map[string]string{"client_id": "nobody"}), "app.example.com", https)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Header().Get("Content-Type"), "application/json")
	assert.Contains(t, rec.Body.String(), `"error":"invalid_client"`)
	assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
	assert.Contains(t, rec.Header().Values("Vary"), "Accept")
}

// Once the redirect URI is valid, a refusal goes back to the client with
// its state (RFC 6749 §4.1.2.1). Any code_challenge_method but S256 is
// refused.
func TestAuthorizeRedirectsRefusalsToTheClient(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		set       map[string]string
		storeErr  error
		wantError string
	}{
		{name: "plain_method", set: map[string]string{"code_challenge": challenge, "code_challenge_method": "plain"}, wantError: "invalid_request"},
		{name: "no_method", set: map[string]string{"code_challenge": challenge}, wantError: "invalid_request"},
		{name: "unknown_method", set: map[string]string{"code_challenge": challenge, "code_challenge_method": "S512"}, wantError: "invalid_request"},
		{name: "plain_method_without_challenge", set: map[string]string{"code_challenge_method": "plain"}, wantError: "invalid_request"},
		{name: "s256_method_without_challenge", set: map[string]string{"code_challenge_method": "S256"}, wantError: "invalid_request"},
		{name: "challenge_too_short", set: map[string]string{"code_challenge": challenge[:42], "code_challenge_method": "S256"}, wantError: "invalid_request"},
		{name: "challenge_not_base64url", set: map[string]string{"code_challenge": challenge[:42] + "+", "code_challenge_method": "S256"}, wantError: "invalid_request"},
		{name: "challenge_nonzero_trailing_bits", set: map[string]string{"code_challenge": challenge[:42] + "N", "code_challenge_method": "S256"}, wantError: "invalid_request"},
		{name: "challenge_with_crlf", set: map[string]string{"code_challenge": challenge[:20] + "\r\n" + challenge[20:], "code_challenge_method": "S256"}, wantError: "invalid_request"},
		{name: "no_state", set: map[string]string{"state": ""}, wantError: "invalid_request"},
		{name: "state_with_nul", set: map[string]string{"state": "xyz\x00"}, wantError: "invalid_request"},
		{name: "state_not_utf8", set: map[string]string{"state": "xyz\xff"}, wantError: "invalid_request"},
		{name: "state_too_long", set: map[string]string{"state": strings.Repeat("s", 2049)}, wantError: "invalid_request"},
		{name: "no_authorization_code_grant", set: map[string]string{"client_id": "no-codes"}, wantError: "unauthorized_client"},
		{name: "prompt_consent", set: map[string]string{"prompt": "login consent"}, wantError: "unauthorized_client"},
		{name: "prompt_none", set: map[string]string{"prompt": "none"}, wantError: "interaction_required"},
		{name: "fragment_mode", set: map[string]string{"response_mode": "fragment"}, wantError: "invalid_request"},
		{name: "request_object", set: map[string]string{"request": "eyJhbGciOiJub25lIn0.e30."}, wantError: "request_not_supported"},
		{name: "request_uri", set: map[string]string{"request_uri": "https://app.example.com/request.jwt"}, wantError: "request_uri_not_supported"},
		{name: "store_unavailable", storeErr: domain.ErrUnavailable().WithParent(errors.New("contention")), wantError: "temporarily_unavailable"},
		{name: "store_fails", storeErr: domain.ErrInternal(errors.New("boom")), wantError: "server_error"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			store := &authRequests{err: tt.storeErr}
			mux := newMux(t, Config{Settings: deployed, Clients: shop, AuthRequests: store})

			rec := send(t, mux, http.MethodGet, authorizePath+authorizeQuery(tt.set), "app.example.com", browser)

			require.Equal(t, http.StatusFound, rec.Code, rec.Body.String())
			location, err := url.Parse(rec.Header().Get("Location"))
			require.NoError(t, err)
			assert.Equal(t, callback, location.Scheme+"://"+location.Host+location.Path)
			// The library answers in the mode the client asked for.
			params := location.Query()
			if location.Fragment != "" {
				params, err = url.ParseQuery(location.Fragment)
				require.NoError(t, err)
			}
			assert.Equal(t, tt.wantError, params.Get("error"))
			wantState := "xyz"
			if state, ok := tt.set["state"]; ok {
				wantState = state
			}
			assert.Equal(t, wantState, params.Get("state"))
			assert.Empty(t, rec.Header().Get("Set-Cookie"))
			assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
		})
	}
}

// bindingCookieNames is the Cookie header of a browser holding n binding
// cookies, oldest first.
func bindingCookieNames(n int) string {
	cookies := make([]string, n)
	for i := range cookies {
		cookies[i] = fmt.Sprintf("__Host-_zauth_authreq_%02d=n", i)
	}
	return strings.Join(cookies, "; ")
}

// assertErrorPage checks that rec is the error page with status and does not
// redirect.
func assertErrorPage(t *testing.T, rec *httptest.ResponseRecorder, status int) {
	t.Helper()
	assert.Equal(t, status, rec.Code)
	assert.Empty(t, rec.Header().Get("Location"))
	assert.Empty(t, rec.Header().Get("Set-Cookie"))
	assert.Contains(t, rec.Header().Get("Content-Type"), "text/html")
	assert.Contains(t, rec.Header().Values("Vary"), "Accept")
	assert.NotContains(t, rec.Body.String(), `"error":`, "the library's JSON is dropped")
}
