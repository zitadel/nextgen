//go:build postgres_integration

package postgres

import (
	"context"
	"crypto/sha256"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func uniqueSessionFixtureIDs(t *testing.T) string {
	t.Helper()
	return "proj-session-" + uniqueSuffix(t)
}

func ensureSessionProject(t *testing.T, projectID string) {
	t.Helper()
	require.NoError(t, testPool.CreateProject(t.Context(), newTestProject(projectID)))
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })
}

func handoffCompletedAttemptForSession(
	t *testing.T,
	projectID string,
	mutate func(*domain.AuthAttempt),
) (plainToken string, attempt *domain.AuthAttempt) {
	t.Helper()
	plainToken = "handoff_" + projectID + "_" + time.Now().Format("150405.000000")
	attempt = &domain.AuthAttempt{
		ProjectID:      projectID,
		RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
		Checks:         []domain.AuthCheck{&domain.AuthFactorPassword{}},
	}
	if mutate != nil {
		mutate(attempt)
	}
	require.NoError(t, testPool.CreateAuthAttempt(t.Context(), attempt))
	sum := sha256.Sum256([]byte(plainToken))
	attempt.HandoffToken = &domain.HandoffToken{TokenHash: sum[:]}
	require.NoError(t, testPool.HandoffAuthAttempt(t.Context(), attempt))
	t.Cleanup(func() {
		_ = testPool.DeleteAuthAttemptByID(context.Background(), projectID, attempt.ID)
	})
	return plainToken, attempt
}

func TestSessionStatements_Create_setsIDsAndToken(t *testing.T) {
	projectID := uniqueSessionFixtureIDs(t)
	ensureSessionProject(t, projectID)

	sess, err := domain.NewSession(projectID, nil)
	require.NoError(t, err)
	require.NoError(t, testPool.CreateSession(t.Context(), sess))
	t.Cleanup(func() {
		_ = testPool.DeleteSessionByID(context.Background(), projectID, sess.ID)
	})

	assert.NotEmpty(t, sess.ID)
	assert.NotEmpty(t, sess.TokenID)
	assert.False(t, sess.CreatedAt.IsZero())
	assert.False(t, sess.ExpiresAt.IsZero())

	got, err := testPool.GetSessionByID(t.Context(), projectID, sess.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.SessionAnonymousTTL, got.TimeToLive)
	assert.Equal(t, sess.TokenID, got.TokenID)

	tok, err := testPool.GetTokenByID(t.Context(), projectID, sess.TokenID)
	require.NoError(t, err)
	assert.Equal(t, domain.TokenTypeSessionToken, tok.Type)
	require.NotNil(t, tok.SessionID)
	assert.Equal(t, sess.ID, *tok.SessionID)
}

func TestSessionStatements_Create_persistsUserAgent(t *testing.T) {
	projectID := uniqueSessionFixtureIDs(t)
	ensureSessionProject(t, projectID)

	ua := &domain.UserAgent{ID: "fp-test-123", IP: "203.0.113.1", Info: map[string]any{"browser": "test"}}
	sess, err := domain.NewSession(projectID, ua)
	require.NoError(t, err)
	require.NoError(t, testPool.CreateSession(t.Context(), sess))
	t.Cleanup(func() {
		_ = testPool.DeleteSessionByID(context.Background(), projectID, sess.ID)
	})

	got, err := testPool.GetSessionByID(t.Context(), projectID, sess.ID)
	require.NoError(t, err)
	require.NotNil(t, got.UserAgent)
	assert.Equal(t, ua.ID, got.UserAgent.ID)
	assert.Equal(t, ua.IP, got.UserAgent.IP)
	assert.Equal(t, "test", got.UserAgent.Info["browser"])
}

func TestSessionStatements_Exchange_deletesAttempt(t *testing.T) {
	projectID := uniqueSessionFixtureIDs(t)
	ensureSessionProject(t, projectID)
	plain, attempt := handoffCompletedAttemptForSession(t, projectID, nil)

	exchanged, err := testPool.ExchangeSession(t.Context(), projectID, plain, nil, 0)
	require.NoError(t, err)
	require.NotEmpty(t, exchanged.ID)
	t.Cleanup(func() {
		_ = testPool.DeleteSessionByID(context.Background(), projectID, exchanged.ID)
	})

	_, err = testPool.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
	require.ErrorIs(t, err, domain.ErrAuthAttemptNotFound())
}

func TestSessionStatements_Exchange_conflictMissingSession(t *testing.T) {
	projectID := uniqueSessionFixtureIDs(t)
	ensureSessionProject(t, projectID)
	missing := "999999"
	plain, _ := handoffCompletedAttemptForSession(t, projectID, func(a *domain.AuthAttempt) {
		a.SessionID = &missing
	})

	_, err := testPool.ExchangeSession(t.Context(), projectID, plain, nil, 0)
	require.ErrorIs(t, err, domain.ErrSessionExchangeConflict())
}

func TestSessionStatements_Exchange_invalidToken(t *testing.T) {
	projectID := uniqueSessionFixtureIDs(t)
	ensureSessionProject(t, projectID)

	_, err := testPool.ExchangeSession(t.Context(), projectID, "no-such-handoff", nil, 0)
	require.ErrorIs(t, err, domain.ErrSessionInvalidHandoffToken())
}

func TestSessionStatements_Exchange_rotatesToken(t *testing.T) {
	t.Run("new_session", func(t *testing.T) {
		projectID := uniqueSessionFixtureIDs(t)
		ensureSessionProject(t, projectID)
		plain, _ := handoffCompletedAttemptForSession(t, projectID, nil)

		exchanged, err := testPool.ExchangeSession(t.Context(), projectID, plain, nil, 0)
		require.NoError(t, err)
		assert.NotEmpty(t, exchanged.TokenID)
		t.Cleanup(func() {
			_ = testPool.DeleteSessionByID(context.Background(), projectID, exchanged.ID)
		})

		tok, err := testPool.GetTokenByID(t.Context(), projectID, exchanged.TokenID)
		require.NoError(t, err)
		assert.Equal(t, domain.TokenTypeSessionToken, tok.Type)
	})

	t.Run("step_up_existing_session", func(t *testing.T) {
		projectID := uniqueSessionFixtureIDs(t)
		ensureSessionProject(t, projectID)

		anonymous, err := domain.NewSession(projectID, nil)
		require.NoError(t, err)
		require.NoError(t, testPool.CreateSession(t.Context(), anonymous))
		oldTokenID := anonymous.TokenID
		t.Cleanup(func() {
			_ = testPool.DeleteSessionByID(context.Background(), projectID, anonymous.ID)
		})

		plain, _ := handoffCompletedAttemptForSession(t, projectID, func(a *domain.AuthAttempt) {
			a.SessionID = &anonymous.ID
		})
		exchanged, err := testPool.ExchangeSession(t.Context(), projectID, plain, nil, 0)
		require.NoError(t, err)
		assert.Equal(t, anonymous.ID, exchanged.ID)
		assert.NotEqual(t, oldTokenID, exchanged.TokenID)

		_, err = testPool.GetTokenByID(t.Context(), projectID, oldTokenID)
		require.Error(t, err)

		current, err := testPool.GetTokenByID(t.Context(), projectID, exchanged.TokenID)
		require.NoError(t, err)
		assert.Equal(t, domain.TokenTypeSessionToken, current.Type)
	})
}

func TestSessionStatements_Exchange_mergeChecks(t *testing.T) {
	t.Run("no_checks_yet", func(t *testing.T) {
		projectID := uniqueSessionFixtureIDs(t)
		ensureSessionProject(t, projectID)
		plain, attempt := handoffCompletedAttemptForSession(t, projectID, nil)

		sess, err := testPool.ExchangeSession(t.Context(), projectID, plain, nil, 0)
		require.NoError(t, err)
		t.Cleanup(func() {
			_ = testPool.DeleteSessionByID(context.Background(), projectID, sess.ID)
		})

		factors := map[domain.AuthCheckType]domain.AuthFactor{}
		for _, f := range sess.Factors {
			factors[f.Type()] = f
		}
		require.Contains(t, factors, domain.AuthCheckTypePassword)

		var n int64
		require.NoError(t, testPool.pool.QueryRow(t.Context(),
			`SELECT COUNT(*) FROM zitadel_nextgen.checks WHERE project_id = $1 AND session_id = $2`,
			projectID, sess.ID,
		).Scan(&n))
		assert.Equal(t, int64(1), n)

		var authAttemptID *string
		require.NoError(t, testPool.pool.QueryRow(t.Context(),
			`SELECT auth_attempt_id FROM zitadel_nextgen.checks WHERE project_id = $1 AND session_id = $2 LIMIT 1`,
			projectID, sess.ID,
		).Scan(&authAttemptID))
		assert.Nil(t, authAttemptID)

		_, err = testPool.GetAuthAttemptByID(t.Context(), projectID, attempt.ID)
		require.ErrorIs(t, err, domain.ErrAuthAttemptNotFound())
	})

	t.Run("promote_multiple_types", func(t *testing.T) {
		projectID := uniqueSessionFixtureIDs(t)
		ensureSessionProject(t, projectID)
		attempt := &domain.AuthAttempt{
			ProjectID: projectID,
			RequiredChecks: []domain.AuthCheckType{
				domain.AuthCheckTypePassword,
				domain.AuthCheckTypePasskey,
			},
			Checks: []domain.AuthCheck{
				&domain.AuthFactorPassword{},
				domain.SetAuthFactorPasskey(time.Now().UTC()),
			},
		}
		require.NoError(t, testPool.CreateAuthAttempt(t.Context(), attempt))
		plain := "handoff_" + projectID
		sum := sha256.Sum256([]byte(plain))
		attempt.HandoffToken = &domain.HandoffToken{TokenHash: sum[:]}
		require.NoError(t, testPool.HandoffAuthAttempt(t.Context(), attempt))
		t.Cleanup(func() {
			_ = testPool.DeleteAuthAttemptByID(context.Background(), projectID, attempt.ID)
		})

		sess, err := testPool.ExchangeSession(t.Context(), projectID, plain, nil, 0)
		require.NoError(t, err)
		t.Cleanup(func() {
			_ = testPool.DeleteSessionByID(context.Background(), projectID, sess.ID)
		})
		factors := map[domain.AuthCheckType]struct{}{}
		for _, f := range sess.Factors {
			factors[f.Type()] = struct{}{}
		}
		assert.Len(t, factors, 2)
	})
}

func TestSessionStatements_Exchange_explicitTTL(t *testing.T) {
	projectID := uniqueSessionFixtureIDs(t)
	ensureSessionProject(t, projectID)
	plain, _ := handoffCompletedAttemptForSession(t, projectID, nil)
	ttl := 2 * time.Hour

	sess, err := testPool.ExchangeSession(t.Context(), projectID, plain, nil, ttl)
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = testPool.DeleteSessionByID(context.Background(), projectID, sess.ID)
	})
	assert.Equal(t, ttl, sess.TimeToLive)
}
