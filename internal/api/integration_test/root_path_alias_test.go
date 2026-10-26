//go:build postgres_integration || spanner_integration

package integration_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

// TestRootPathAliasServesTheSignIn holds the alias to the real server until
// 1.0.0 (ADR 077): an app on an earlier SDK still exchanges its handoff and
// reads its session at the root paths. Both answer as under the prefix, and
// say they are deprecated; the session read keeps its no-store header. The
// liveness probe answers at the root without that, for good. Every other
// test of this package calls the prefix.
func TestRootPathAliasServesTheSignIn(t *testing.T) {
	t.Parallel()

	origin := harness.EnsureTestServer(t).URL
	httpClient := harness.EnsureHttpClient(t)

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	projectSecret, err := harness.EnsureTokenService(t).GenerateJWE(t.Context(), project.Token())
	require.NoError(t, err)

	// Completed by a verified password; no user, so the session has none.
	attempt := &domain.AuthAttempt{ProjectID: project.ID, Checks: []domain.AuthCheck{&domain.AuthFactorPassword{}}}
	stmts := harness.EnsureServiceDB(t)
	require.NoError(t, stmts.Statements().CreateAuthAttempt(t.Context(), attempt))
	const plainToken = "handoff_root_path_alias_test"
	sum := sha256.Sum256([]byte(plainToken))
	attempt.HandoffToken = &domain.HandoffToken{TokenHash: sum[:]}
	require.NoError(t, stmts.Statements().HandoffAuthAttempt(t.Context(), attempt))

	requireDeprecated := func(t *testing.T, resp *http.Response) {
		t.Helper()
		assert.Regexp(t, `^@[1-9][0-9]*$`, resp.Header.Get("Deprecation"))
		assert.Contains(t, resp.Header.Get("Link"), `rel="deprecation"`)
	}

	exchangeBody, err := json.Marshal(map[string]string{"handoff_token": plainToken})
	require.NoError(t, err)
	exchangeReq, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
		origin+"/sessions/exchange?project_id="+project.ID, bytes.NewReader(exchangeBody))
	require.NoError(t, err)
	exchangeReq.Header.Set("Content-Type", "application/json")
	exchangeReq.Header.Set("Authorization", "Bearer "+projectSecret)
	exchangeResp, err := httpClient.Do(exchangeReq)
	require.NoError(t, err)
	defer func() { _ = exchangeResp.Body.Close() }()
	if exchangeResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(exchangeResp.Body)
		t.Fatalf("exchange returned %d: %s", exchangeResp.StatusCode, body)
	}
	requireDeprecated(t, exchangeResp)
	var sessionCookie *http.Cookie
	for _, cookie := range exchangeResp.Cookies() {
		if cookie.Name == "__nextgen_session" {
			sessionCookie = cookie
		}
	}
	require.NotNil(t, sessionCookie, "exchange must set the __nextgen_session cookie")

	meReq, err := http.NewRequestWithContext(t.Context(), http.MethodGet, origin+"/sessions/me", nil)
	require.NoError(t, err)
	meReq.AddCookie(sessionCookie)
	meResp, err := httpClient.Do(meReq)
	require.NoError(t, err)
	defer func() { _ = meResp.Body.Close() }()
	require.Equal(t, http.StatusOK, meResp.StatusCode)
	assert.Equal(t, "private, no-store", meResp.Header.Get("Cache-Control"))
	requireDeprecated(t, meResp)
	var session struct {
		ProjectID string `json:"project_id"`
	}
	require.NoError(t, json.NewDecoder(meResp.Body).Decode(&session))
	assert.Equal(t, project.ID, session.ProjectID)

	liveResp, err := httpClient.Get(origin + "/livez")
	require.NoError(t, err)
	defer func() { _ = liveResp.Body.Close() }()
	assert.Equal(t, http.StatusOK, liveResp.StatusCode)
	assert.Empty(t, liveResp.Header.Get("Deprecation"))
}
