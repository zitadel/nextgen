//go:build postgres_integration || spanner_integration

package integration_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

// TestExchangeHandoff_RefusedToken pins what POST /sessions/exchange answers
// for a handoff token it will not exchange: 400 sess.invalid_handoff_token,
// the status the contract declares. A successful exchange deletes the
// attempt, so a replay is the same lookup miss as a token the server never
// issued, and the two get the same answer. An expired token carries the same
// code, so it gets the same status too.
func TestExchangeHandoff_RefusedToken(t *testing.T) {
	t.Parallel()

	testServer := harness.EnsureTestServer(t)

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	projectSecret, err := harness.EnsureTokenService(t).GenerateJWE(t.Context(), project.Token())
	require.NoError(t, err)

	// exchange posts the token and returns the status and the error code, if
	// the answer carries one.
	exchange := func(t *testing.T, handoffToken string) (int, string) {
		t.Helper()
		body, err := json.Marshal(map[string]string{"handoff_token": handoffToken})
		require.NoError(t, err)
		req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
			testServer.URL+"/sessions/exchange?project_id="+project.ID, bytes.NewReader(body))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+projectSecret)

		resp, err := testServer.Client().Do(req)
		require.NoError(t, err)
		defer func() { _ = resp.Body.Close() }()
		raw, err := io.ReadAll(resp.Body)
		require.NoError(t, err)
		var got struct {
			Code string `json:"code"`
		}
		require.NoError(t, json.Unmarshal(raw, &got), string(raw))
		return resp.StatusCode, got.Code
	}

	t.Run("replay of an exchanged token", func(t *testing.T) {
		// A completed attempt with no required checks, handed off: the
		// exchange makes a session without a user.
		attempt := &domain.AuthAttempt{ProjectID: project.ID}
		stmts := harness.EnsureServiceDB(t).Statements()
		require.NoError(t, stmts.CreateAuthAttempt(t.Context(), attempt))
		plainToken := "handoff_" + helpers.RandString(12)
		sum := sha256.Sum256([]byte(plainToken))
		attempt.HandoffToken = &domain.HandoffToken{TokenHash: sum[:]}
		require.NoError(t, stmts.HandoffAuthAttempt(t.Context(), attempt))

		status, code := exchange(t, plainToken)
		require.Equal(t, http.StatusOK, status, "first exchange answered %s", code)

		status, code = exchange(t, plainToken)
		require.Equal(t, http.StatusBadRequest, status)
		require.Equal(t, "sess.invalid_handoff_token", code)
	})

	t.Run("token the server never issued", func(t *testing.T) {
		status, code := exchange(t, "handoff_never_issued")
		require.Equal(t, http.StatusBadRequest, status)
		require.Equal(t, "sess.invalid_handoff_token", code)
	})
}
