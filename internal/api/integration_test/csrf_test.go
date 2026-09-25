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

// TestSessionCSRF pins ADR 053 §5 as scoped for #1300: every unsafe request
// the session cookie authenticates must be same-origin, and the management
// writes (plus claim/complete and the user's own profile write) must also
// carry the session-bound X-Zitadel-CSRF token that GET /sessions/me hands
// out. A Bearer caller is untouched.
func TestSessionCSRF(t *testing.T) {
	t.Parallel()

	console := harness.EnsurePlatformProject(t)
	operatorID, _ := harness.CreateUserOwnedByTeam(t, console.ID)
	harness.SeedProjectAdmin(t, console.ID, operatorID)
	cookie := platformSessionCookie(t, operatorID)
	base := harness.EnsureTestServer(t).URL

	// raw sends one request with the session cookie and whatever headers the
	// case sets, bypassing the generated client's own CSRF header.
	raw := func(t *testing.T, method, path, body string, headers map[string]string) (int, string) {
		t.Helper()
		req, err := http.NewRequestWithContext(t.Context(), method, base+path, strings.NewReader(body))
		require.NoError(t, err)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		req.AddCookie(cookie)
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
	createTeam := func() string {
		return `{"name":"` + helpers.TeamName() + `"}`
	}
	teamsPath := "/teams?project_id=" + console.ID

	t.Run("sessions/me hands out the session's token", func(t *testing.T) {
		t.Parallel()
		status, body := raw(t, http.MethodGet, "/sessions/me", "", nil)
		require.Equal(t, http.StatusOK, status, body)
		var me struct {
			CSRFToken string `json:"csrf_token"`
		}
		require.NoError(t, json.Unmarshal([]byte(body), &me))
		assert.Equal(t, internalapi.CSRFToken(cookie.Value), me.CSRFToken)
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
		assert.Equal(t, http.StatusForbidden, status, body)
		assert.Contains(t, body, `"auth.csrf_invalid"`)
	})

	t.Run("a write with another session's token is refused", func(t *testing.T) {
		t.Parallel()
		status, body := raw(t, http.MethodPost, teamsPath, createTeam(), map[string]string{
			internalapi.CSRFHeader: internalapi.CSRFToken("some-other-session"),
		})
		assert.Equal(t, http.StatusForbidden, status, body)
	})

	t.Run("a cross-site write is refused even with the token", func(t *testing.T) {
		t.Parallel()
		status, body := raw(t, http.MethodPost, teamsPath, createTeam(), map[string]string{
			internalapi.CSRFHeader: internalapi.CSRFToken(cookie.Value),
			"Sec-Fetch-Site":       "cross-site",
			"Origin":               "https://evil.example",
		})
		assert.Equal(t, http.StatusForbidden, status, body)
	})

	// Reads may omit the token (ADR 053 §5), but a POST query is still an
	// unsafe method, so the origin check applies to it.
	t.Run("a query POST needs no token but must be same-origin", func(t *testing.T) {
		t.Parallel()
		status, body := raw(t, http.MethodPost, "/teams/query?project_id="+console.ID, `{}`, nil)
		assert.Equal(t, http.StatusOK, status, body)

		status, body = raw(t, http.MethodPost, "/teams/query?project_id="+console.ID, `{}`, map[string]string{
			"Sec-Fetch-Site": "cross-site",
			"Origin":         "https://evil.example",
		})
		assert.Equal(t, http.StatusForbidden, status, body)
	})

	// Logout gets the origin check only: customer apps sign out through the
	// SDK proxies, which cannot send the token yet.
	t.Run("logout needs no token but must be same-origin", func(t *testing.T) {
		t.Parallel()
		status, body := raw(t, http.MethodDelete, "/sessions/me", "", map[string]string{
			"Sec-Fetch-Site": "cross-site",
			"Origin":         "https://evil.example",
		})
		assert.Equal(t, http.StatusForbidden, status, body)

		other := platformSessionCookie(t, operatorID)
		req, err := http.NewRequestWithContext(t.Context(), http.MethodDelete, base+"/sessions/me", nil)
		require.NoError(t, err)
		req.AddCookie(other)
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		resp, err := harness.EnsureHttpClient(t).Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		assert.Equal(t, http.StatusNoContent, resp.StatusCode)
	})

	t.Run("the generated client without the token is refused", func(t *testing.T) {
		t.Parallel()
		session := sessionClientForUser(t, operatorID)
		session.SetOmitCSRF(true)
		resp, err := session.CreateTeam(t.Context(), &api.CreateTeamRequest{Name: helpers.TeamName()},
			api.CreateTeamParams{ProjectID: api.ProjectID(console.ID)})
		require.NoError(t, err)
		require.IsNotType(t, &api.TeamResponse{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("a project secret needs no token", func(t *testing.T) {
		t.Parallel()
		secret, err := helpers.NewApiClient(base)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, secret, console)
		resp, err := secret.CreateTeam(t.Context(), &api.CreateTeamRequest{Name: helpers.TeamName()},
			api.CreateTeamParams{ProjectID: api.ProjectID(console.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.TeamResponse{}, resp, helpers.MustMarshal(t, resp))
	})
}
