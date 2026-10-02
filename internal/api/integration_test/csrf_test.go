//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	internalapi "github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
)

// cookieRequest sends one request with the session cookie and exactly the
// headers given, bypassing the generated client (which adds the CSRF header on
// its own), and returns the status and body. The integration tests that need a
// raw cookie request share it.
func cookieRequest(t *testing.T, cookie *http.Cookie, method, path, body string, headers map[string]string) (int, string) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), method, harness.EnsureTestServer(t).URL+path, strings.NewReader(body))
	require.NoError(t, err)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	resp, err := harness.EnsureHttpClient(t).Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	payload, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp.StatusCode, string(payload)
}

// TestSessionCSRF pins ADR 053 §5 as scoped for #1300: every unsafe request
// the session cookie authenticates must be same-origin, and, except sign-out and
// the POST query reads, must also carry the session-bound X-Zitadel-CSRF token
// that GET /sessions/me/csrf hands out. A Bearer caller is untouched.
func TestSessionCSRF(t *testing.T) {
	t.Parallel()

	home, operatorID, cookie := ownSessionUser(t)
	harness.SeedProjectAdmin(t, home.ID, operatorID)
	base := harness.EnsureTestServer(t).URL

	raw := func(t *testing.T, method, path, body string, headers map[string]string) (int, string) {
		t.Helper()
		return cookieRequest(t, cookie, method, path, body, headers)
	}
	createTeam := func() string {
		return `{"name":"` + helpers.TeamName() + `"}`
	}
	teamsPath := "/teams?project_id=" + home.ID
	// requireCSRFRefused pins the refusal to the CSRF check itself: a 403 alone
	// would also pass for an authorization denial.
	requireCSRFRefused := func(t *testing.T, status int, body string) {
		t.Helper()
		require.Equal(t, http.StatusForbidden, status, body)
		require.JSONEq(t, `{"code":"auth.csrf_invalid","message":"The request failed cross-site request forgery validation."}`, body)
	}

	t.Run("sessions/me/csrf hands out the session's token", func(t *testing.T) {
		t.Parallel()
		status, body := raw(t, http.MethodGet, "/sessions/me/csrf", "", nil)
		require.Equal(t, http.StatusOK, status, body)
		var token struct {
			CSRFToken string `json:"csrf_token"`
		}
		require.NoError(t, json.Unmarshal([]byte(body), &token))
		assert.Equal(t, internalapi.CSRFToken(cookie.Value), token.CSRFToken)

		// The session representation itself is unchanged: the token has its
		// own resource.
		status, body = raw(t, http.MethodGet, "/sessions/me", "", nil)
		require.Equal(t, http.StatusOK, status, body)
		assert.NotContains(t, body, "csrf_token")
	})

	t.Run("sessions/me/csrf needs the session cookie", func(t *testing.T) {
		t.Parallel()
		req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, base+"/sessions/me/csrf", nil)
		require.NoError(t, err)
		resp, err := harness.EnsureHttpClient(t).Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
		assert.Equal(t, "private, no-store", resp.Header.Get("Cache-Control"))
	})

	t.Run("a write with the token is accepted", func(t *testing.T) {
		t.Parallel()
		status, body := raw(t, http.MethodPost, teamsPath, createTeam(), map[string]string{
			internalapi.CSRFHeader: internalapi.CSRFToken(cookie.Value),
		})
		assert.Equal(t, http.StatusCreated, status, body)
	})

	t.Run("a write without the token is refused", func(t *testing.T) {
		t.Parallel()
		status, body := raw(t, http.MethodPost, teamsPath, createTeam(), nil)
		requireCSRFRefused(t, status, body)
	})

	t.Run("a write with another session's token is refused", func(t *testing.T) {
		t.Parallel()
		status, body := raw(t, http.MethodPost, teamsPath, createTeam(), map[string]string{
			internalapi.CSRFHeader: internalapi.CSRFToken("some-other-session"),
		})
		requireCSRFRefused(t, status, body)
	})

	t.Run("a cross-site write is refused even with the token", func(t *testing.T) {
		t.Parallel()
		status, body := raw(t, http.MethodPost, teamsPath, createTeam(), map[string]string{
			internalapi.CSRFHeader: internalapi.CSRFToken(cookie.Value),
			"Sec-Fetch-Site":       "cross-site",
			"Origin":               "https://evil.example",
		})
		requireCSRFRefused(t, status, body)
	})

	// Reads may omit the token (ADR 053 §5), but a POST query is still an
	// unsafe method, so the origin check applies to it.
	t.Run("a query POST needs no token but must be same-origin", func(t *testing.T) {
		t.Parallel()
		status, body := raw(t, http.MethodPost, "/teams/query?project_id="+home.ID, `{}`, nil)
		assert.Equal(t, http.StatusOK, status, body)

		status, body = raw(t, http.MethodPost, "/teams/query?project_id="+home.ID, `{}`, map[string]string{
			"Sec-Fetch-Site": "cross-site",
			"Origin":         "https://evil.example",
		})
		requireCSRFRefused(t, status, body)
	})

	// Logout gets the origin check only: customer apps sign out through the
	// SDK proxies, which cannot send the token yet. It signs out its own
	// session, so a regression cannot revoke the one the other subtests share.
	t.Run("logout needs no token but must be same-origin", func(t *testing.T) {
		t.Parallel()
		own := sessionCookieIn(t, home, operatorID)
		status, body := cookieRequest(t, own, http.MethodDelete, "/sessions/me", "",
			map[string]string{"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example"})
		requireCSRFRefused(t, status, body)

		status, body = cookieRequest(t, own, http.MethodDelete, "/sessions/me", "",
			map[string]string{"Sec-Fetch-Site": "same-origin"})
		assert.Equal(t, http.StatusNoContent, status, body)
	})

	// The generated client must decode the refusal into a typed response, not
	// fail with "unknown type": every cookie-authenticated write declares the
	// code in its error union.
	t.Run("the generated client decodes the refusal", func(t *testing.T) {
		t.Parallel()
		session, err := helpers.NewApiClient(base)
		require.NoError(t, err)
		session.SetSessionToken(cookie.Value)
		session.SetOmitCSRF(true)

		team, err := session.CreateTeam(t.Context(), &api.CreateTeamRequest{Name: helpers.TeamName()},
			api.CreateTeamParams{ProjectID: api.ProjectID(home.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.CreateTeamForbidden{}, team, helpers.MustMarshal(t, team))
		assert.Equal(t, api.ErrorCode("auth.csrf_invalid"), team.(*api.CreateTeamForbidden).Code)

		patch := &api.PatchMyUserRequest{}
		require.NoError(t, patch.UnmarshalJSON([]byte(`{"attributes":{"nickname":"Myself"}}`)))
		me, err := session.PatchMyUser(t.Context(), patch)
		require.NoError(t, err)
		require.IsType(t, &api.PatchMyUserErrorResponseStatusCode{}, me, helpers.MustMarshal(t, me))
		refused := me.(*api.PatchMyUserErrorResponseStatusCode)
		assert.Equal(t, http.StatusForbidden, refused.StatusCode)
		assert.True(t, refused.Response.IsAuthCsrfInvalid(), helpers.MustMarshal(t, me))

		claim, err := session.CompleteClaim(t.Context(), &api.CompleteClaimRequest{ChallengeID: "ch_any"},
			api.CompleteClaimParams{ProjectID: api.ProjectID(home.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.CompleteClaimForbidden{}, claim, helpers.MustMarshal(t, claim))
		assert.True(t, claim.(*api.CompleteClaimForbidden).IsAuthCsrfInvalid(), helpers.MustMarshal(t, claim))
	})

	t.Run("a project secret needs no token", func(t *testing.T) {
		t.Parallel()
		secret, err := helpers.NewApiClient(base)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, secret, home)
		resp, err := secret.CreateTeam(t.Context(), &api.CreateTeamRequest{Name: helpers.TeamName()},
			api.CreateTeamParams{ProjectID: api.ProjectID(home.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.TeamResponse{}, resp, helpers.MustMarshal(t, resp))
	})
}
