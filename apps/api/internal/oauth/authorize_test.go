package oauth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
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

// unavailable is a ClientResolver whose storage is down.
type unavailable struct{}

func (unavailable) Client(context.Context, string, string, string) (domain.ApplicationClientDocument, error) {
	return domain.ApplicationClientDocument{}, domain.ErrUnavailable()
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
		"scope":         {"openid"},
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
// to the browser by a cookie of its own.
func TestAuthorizeReachesTheLoginPage(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name          string
		set           map[string]string
		wantChallenge string
	}{
		{name: "without_pkce"},
		{name: "with_pkce", set: map[string]string{"code_challenge": challenge, "code_challenge_method": "S256"}, wantChallenge: challenge},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			store := &authRequests{}
			mux := newMux(t, Config{Settings: deployed, Clients: shop, AuthRequests: store})

			rec := send(t, mux, http.MethodGet, authorizePath+authorizeQuery(tt.set), "app.example.com", browser)

			require.Equal(t, http.StatusFound, rec.Code, rec.Body.String())
			assert.Equal(t, "https://app.example.com/login?auth_request=authreq_1", rec.Header().Get("Location"))
			assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
			assert.Equal(t, "__Host-_zauth_authreq_1=nonce; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Lax", rec.Header().Get("Set-Cookie"))
			require.Len(t, store.stored, 1)
			assert.Equal(t, &domain.AuthRequest{
				ProjectID:     "proj_123",
				ID:            "authreq_1",
				ClientID:      "shop",
				RedirectURI:   callback,
				State:         "xyz",
				Scopes:        []string{"openid"},
				CodeChallenge: tt.wantChallenge,
				Issuer:        "https://app.example.com/oauth/proj_123",
				DeploymentID:  "dep_1",
				ReleaseID:     "rel_1",
			}, store.stored[0])
		})
	}
}

// A loopback issuer on plain http gets a cookie without the __Host- prefix,
// which a browser only accepts with Secure, and a loopback redirect URI
// matches on any port.
func TestAuthorizeOnLoopback(t *testing.T) {
	t.Parallel()
	store := &authRequests{}
	mux := newMux(t, Config{Settings: deployed, Clients: shop, AuthRequests: store})

	query := authorizeQuery(map[string]string{"redirect_uri": "http://127.0.0.1:4000/callback"})
	rec := send(t, mux, http.MethodGet, authorizePath+query, "localhost:8080", map[string]string{"Accept": "text/html"})

	require.Equal(t, http.StatusFound, rec.Code, rec.Body.String())
	assert.Equal(t, "http://localhost:8080/login?auth_request=authreq_1", rec.Header().Get("Location"))
	assert.Equal(t, "_zauth_authreq_1=nonce; Path=/; Max-Age=900; HttpOnly; SameSite=Lax", rec.Header().Get("Set-Cookie"))
	require.Len(t, store.stored, 1)
	assert.Equal(t, "http://127.0.0.1:4000/callback", store.stored[0].RedirectURI)
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
		{name: "not_canonical", loginPath: "/login%2"},
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
		name       string
		settings   SettingsSource
		clients    ClientResolver
		set        map[string]string
		wantStatus int
	}{
		{name: "unknown_client", set: map[string]string{"client_id": "nobody"}, wantStatus: http.StatusBadRequest},
		{name: "unregistered_redirect_uri", set: map[string]string{"redirect_uri": "https://evil.example/callback"}, wantStatus: http.StatusBadRequest},
		{name: "missing_redirect_uri", set: map[string]string{"redirect_uri": ""}, wantStatus: http.StatusBadRequest},
		{name: "clients_unavailable", clients: unavailable{}, wantStatus: http.StatusInternalServerError},
		{name: "oauth_off", settings: settings{}, wantStatus: http.StatusNotFound},
		{name: "settings_without_deployment", settings: settings{settings: Settings{Enabled: true, ReleaseID: "rel_1"}}, wantStatus: http.StatusInternalServerError},
		{name: "settings_without_release", settings: settings{settings: Settings{Enabled: true, DeploymentID: "dep_1"}}, wantStatus: http.StatusInternalServerError},
		{name: "settings_fail", settings: settings{err: domain.ErrInternal(errors.New("boom"))}, wantStatus: http.StatusInternalServerError},
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

			rec := send(t, mux, http.MethodGet, authorizePath+authorizeQuery(tt.set), "app.example.com", browser)

			assertErrorPage(t, rec, tt.wantStatus)
			assert.Empty(t, store.stored)
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
		{name: "no_authorization_code_grant", set: map[string]string{"client_id": "no-codes"}, wantError: "unauthorized_client"},
		{name: "fragment_mode", set: map[string]string{"response_mode": "fragment"}, wantError: "invalid_request"},
		{name: "request_object", set: map[string]string{"request": "eyJhbGciOiJub25lIn0.e30."}, wantError: "request_not_supported"},
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
			assert.Equal(t, "xyz", params.Get("state"))
			assert.Empty(t, rec.Header().Get("Set-Cookie"))
			assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
		})
	}
}

// assertErrorPage checks that rec is the error page with status and does not
// redirect.
func assertErrorPage(t *testing.T, rec *httptest.ResponseRecorder, status int) {
	t.Helper()
	assert.Equal(t, status, rec.Code)
	assert.Empty(t, rec.Header().Get("Location"))
	assert.Empty(t, rec.Header().Get("Set-Cookie"))
	assert.Contains(t, rec.Header().Get("Content-Type"), "text/html")
	assert.NotContains(t, rec.Body.String(), `"error":`, "the library's JSON is dropped")
}
