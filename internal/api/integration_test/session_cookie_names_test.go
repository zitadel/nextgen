//go:build postgres_integration || spanner_integration

package integration_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/api/client"
	internalapi "github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/domain"
)

// TestSessionCookieNames pins ADR 083 over HTTP: the name the server sets the
// session cookie under on each transport, the names it reads there, and that
// the names before ADR 083 sign nobody in. The harness's server leaves out the
// production chain's request-host middleware, so every request there counts
// as https; this one runs behind it and the loopback-cookie middleware, in the
// production order (buildHTTPMux), and a request without X-Forwarded-Proto is
// plain http to a loopback host. The API answers under its prefix (ADR 077).
func TestSessionCookieNames(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	internalapi.MountAPI(mux, func(next http.Handler) http.Handler {
		return internalapi.WithRequestHostMiddleware(internalapi.WithLoopbackSessionCookie(
			internalapi.WithSessionStateNoStore(internalapi.WithCSRFRequest(next))))
	}, harness.EnsureAPIServers(t))
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	project, _, cookie := ownSessionUser(t)
	token := cookie.Value

	do := func(t *testing.T, method, path string, https bool, cookies string, header http.Header) *http.Response {
		t.Helper()
		req, err := http.NewRequestWithContext(t.Context(), method, server.URL+client.PathPrefix+path, nil)
		require.NoError(t, err)
		for name, values := range header {
			req.Header[name] = values
		}
		if https {
			req.Header.Set("X-Forwarded-Proto", "https")
		}
		if cookies != "" {
			req.Header.Set("Cookie", cookies)
		}
		resp, err := server.Client().Do(req)
		require.NoError(t, err)
		t.Cleanup(func() { _ = resp.Body.Close() })
		return resp
	}

	t.Run("reads", func(t *testing.T) {
		t.Parallel()
		cases := []struct {
			name    string
			https   bool
			cookies string
			status  int
		}{
			{name: "loopback http reads the loopback name", cookies: "zitadel_session=" + token, status: http.StatusOK},
			{name: "loopback http reads the canonical name", cookies: "__Host-zitadel_session=" + token, status: http.StatusOK},
			{name: "https reads the canonical name", https: true, cookies: "__Host-zitadel_session=" + token, status: http.StatusOK},
			{name: "https refuses the loopback name", https: true, cookies: "zitadel_session=" + token, status: http.StatusUnauthorized},
			{name: "loopback http refuses the old name", cookies: "__nextgen_session=" + token, status: http.StatusUnauthorized},
			{name: "https refuses the old name", https: true, cookies: "__nextgen_session=" + token, status: http.StatusUnauthorized},
			{name: "https refuses the old project name", https: true, cookies: "__nextgen_session_" + project.ID + "=" + token, status: http.StatusUnauthorized},
			{name: "https ignores an old name before the canonical one", https: true, cookies: "__nextgen_session=garbage; __Host-zitadel_session=" + token, status: http.StatusOK},
			{name: "https ignores an old name after the canonical one", https: true, cookies: "__Host-zitadel_session=" + token + "; __nextgen_session=garbage", status: http.StatusOK},
			{name: "loopback http ignores an old name before the loopback one", cookies: "__nextgen_session=garbage; zitadel_session=" + token, status: http.StatusOK},
			{name: "loopback http prefers the canonical name", cookies: "zitadel_session=garbage; __Host-zitadel_session=" + token, status: http.StatusOK},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()
				resp := do(t, http.MethodGet, "/sessions/me?project_id="+project.ID, tc.https, tc.cookies, nil)
				body, _ := io.ReadAll(resp.Body)
				require.Equal(t, tc.status, resp.StatusCode, string(body))
			})
		}
	})

	t.Run("writes", func(t *testing.T) {
		t.Parallel()
		secret, err := harness.EnsureTokenService(t).GenerateJWE(t.Context(), project.Token())
		require.NoError(t, err)
		cases := []struct {
			name   string
			https  bool
			cookie string
			secure bool
		}{
			{name: "loopback http", cookie: "zitadel_session", secure: false},
			{name: "https", https: true, cookie: "__Host-zitadel_session", secure: true},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()
				body, err := json.Marshal(map[string]string{"handoff_token": handedOffAttempt(t, project, tc.name)})
				require.NoError(t, err)
				req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
					server.URL+client.PathPrefix+"/sessions/exchange?project_id="+project.ID, bytes.NewReader(body))
				require.NoError(t, err)
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Authorization", "Bearer "+secret)
				if tc.https {
					req.Header.Set("X-Forwarded-Proto", "https")
				}
				exchanged, err := server.Client().Do(req)
				require.NoError(t, err)
				t.Cleanup(func() { _ = exchanged.Body.Close() })
				raw, _ := io.ReadAll(exchanged.Body)
				require.Equal(t, http.StatusOK, exchanged.StatusCode, string(raw))
				set := onlySessionCookie(t, exchanged)
				assert.Equal(t, tc.cookie, set.Name)
				assert.Equal(t, tc.secure, set.Secure)
				assert.Equal(t, "/", set.Path)
				assert.Empty(t, set.Domain)
				assert.True(t, set.HttpOnly)
				assert.Equal(t, http.SameSiteLaxMode, set.SameSite)

				signedOut := do(t, http.MethodDelete, "/sessions/me?project_id="+project.ID, tc.https,
					tc.cookie+"="+set.Value, http.Header{internalapi.CSRFHeader: {internalapi.CSRFToken(set.Value)}})
				require.Equal(t, http.StatusNoContent, signedOut.StatusCode)
				cleared := onlySessionCookie(t, signedOut)
				assert.Equal(t, tc.cookie, cleared.Name, "sign-out clears the name it set")
				assert.Less(t, cleared.MaxAge, 0)
			})
		}
	})
}

// handedOffAttempt seeds a completed, handed-off attempt in project, the state
// the flow engine leaves behind, and returns its handoff token.
func handedOffAttempt(t *testing.T, project *domain.Project, label string) string {
	t.Helper()
	attempt := &domain.AuthAttempt{ProjectID: project.ID, Checks: []domain.AuthCheck{&domain.AuthFactorPassword{}}}
	stmts := harness.EnsureServiceDB(t)
	require.NoError(t, stmts.Statements().CreateAuthAttempt(t.Context(), attempt))
	plainToken := "handoff_cookie_names_" + project.ID + "_" + label
	sum := sha256.Sum256([]byte(plainToken))
	attempt.HandoffToken = &domain.HandoffToken{TokenHash: sum[:]}
	require.NoError(t, stmts.Statements().HandoffAuthAttempt(t.Context(), attempt))
	return plainToken
}

// onlySessionCookie is the one session cookie resp sets, under any name.
func onlySessionCookie(t *testing.T, resp *http.Response) *http.Cookie {
	t.Helper()
	var found []*http.Cookie
	for _, cookie := range resp.Cookies() {
		if cookie.Name == "zitadel_session" || cookie.Name == "__Host-zitadel_session" {
			found = append(found, cookie)
		}
	}
	require.Len(t, found, 1, resp.Header.Values("Set-Cookie"))
	return found[0]
}
