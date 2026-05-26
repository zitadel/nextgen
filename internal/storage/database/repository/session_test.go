package repository_test

import (
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func countChecks(t *testing.T, tx database.QueryExecutor, query string, args ...any) int64 {
	t.Helper()
	var n int64
	err := tx.QueryRow(t.Context(), query, args...).Scan(&n)
	require.NoError(t, err)
	return n
}

func sessionFactorsByType(session *domain.Session) map[domain.AuthCheckType]domain.AuthFactor {
	out := make(map[domain.AuthCheckType]domain.AuthFactor, len(session.Factors))
	for _, f := range session.Factors {
		out[f.Type()] = f
	}
	return out
}

func handoffTokenForTest(plain string) *domain.HandoffToken {
	sum := sha256.Sum256([]byte(plain))
	return &domain.HandoffToken{TokenHash: sum[:]}
}

func handoffCompletedAttempt(
	t *testing.T,
	tx database.QueryExecutor,
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
	ensureProject(t, tx, projectID)
	require.NoError(t, repository.NewAuthAttemptRepository(pool).Create(t.Context(), tx, attempt))
	attempt.HandoffToken = handoffTokenForTest(plainToken)
	require.NoError(t, repository.NewAuthAttemptRepository(pool).Handoff(t.Context(), tx, attempt))
	return plainToken, attempt
}

func TestSession_Create(t *testing.T) {
	repo := repository.NewSessionRepository(pool)

	t.Run("sets ids and expiry", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		session, err := domain.NewSession("p-sess-create", nil)
		require.NoError(t, err)
		ensureProject(t, tx, session.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, session))
		assert.NotEmpty(t, session.ID)
		assert.NotEmpty(t, session.TokenID)
		assert.Equal(t, session.ID, session.TokenID)
		assert.False(t, session.CreatedAt.IsZero())
		assert.False(t, session.ExpiresAt.IsZero())

		stored, err := repo.Get(t.Context(), tx, session.ProjectID, session.ID)
		require.NoError(t, err)
		assert.Equal(t, domain.SessionAnonymousTTL, stored.TimeToLive)
		assert.WithinDuration(t, stored.UpdatedAt.Add(stored.TimeToLive), stored.ExpiresAt, 2*time.Second)
	})

	t.Run("persists user agent", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		ua := &domain.UserAgent{ID: "fp-test-123", IP: "203.0.113.1", Info: map[string]any{"browser": "test"}}
		session, err := domain.NewSession("p-sess-ua", ua)
		require.NoError(t, err)
		ensureProject(t, tx, session.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, session))

		stored, err := repo.Get(t.Context(), tx, session.ProjectID, session.ID)
		require.NoError(t, err)
		require.NotNil(t, stored.UserAgent)
		assert.Equal(t, ua.ID, stored.UserAgent.ID)
		assert.Equal(t, ua.IP, stored.UserAgent.IP)
		assert.Equal(t, "test", stored.UserAgent.Info["browser"])
	})
}

func TestSession_Get(t *testing.T) {
	repo := repository.NewSessionRepository(pool)

	t.Run("not found", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		_, err := repo.Get(t.Context(), tx, "p-missing", "999999")
		require.ErrorIs(t, err, domain.ErrSessionNotFound())
	})

	t.Run("empty factors on anonymous session", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		session, err := domain.NewSession("p-sess-get", nil)
		require.NoError(t, err)
		ensureProject(t, tx, session.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, session))

		stored, err := repo.Get(t.Context(), tx, session.ProjectID, session.ID)
		require.NoError(t, err)
		assert.Empty(t, stored.Factors)
	})

	t.Run("loads factors after exchange", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		projectID := "p-sess-get-factors"
		plain, _ := handoffCompletedAttempt(t, tx, projectID, nil)
		exchanged, err := repo.Exchange(t.Context(), tx, projectID, plain, nil, 0)
		require.NoError(t, err)

		stored, err := repo.Get(t.Context(), tx, projectID, exchanged.ID)
		require.NoError(t, err)
		factors := sessionFactorsByType(stored)
		require.Contains(t, factors, domain.AuthCheckTypePassword)
		assert.False(t, factors[domain.AuthCheckTypePassword].GetLastVerifiedAt().IsZero())
	})
}

func TestSession_List(t *testing.T) {
	repo := repository.NewSessionRepository(pool)

	t.Run("returns all sessions in project", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		projectID := "p-sess-list"
		ensureProject(t, tx, projectID)

		for range 2 {
			s, err := domain.NewSession(projectID, nil)
			require.NoError(t, err)
			require.NoError(t, repo.Create(t.Context(), tx, s))
		}

		list, err := repo.List(t.Context(), tx, projectID)
		require.NoError(t, err)
		assert.Len(t, list, 2)
	})

	t.Run("loads factors for exchanged session only", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		projectID := "p-sess-list-factors"
		ensureProject(t, tx, projectID)

		anonymous, err := domain.NewSession(projectID, nil)
		require.NoError(t, err)
		require.NoError(t, repo.Create(t.Context(), tx, anonymous))

		plain, _ := handoffCompletedAttempt(t, tx, projectID, nil)
		exchanged, err := repo.Exchange(t.Context(), tx, projectID, plain, nil, 0)
		require.NoError(t, err)

		list, err := repo.List(t.Context(), tx, projectID)
		require.NoError(t, err)
		require.Len(t, list, 2)

		byID := make(map[string]*domain.Session, len(list))
		for _, s := range list {
			byID[s.ID] = s
		}
		assert.Empty(t, byID[anonymous.ID].Factors)
		factors := sessionFactorsByType(byID[exchanged.ID])
		require.Contains(t, factors, domain.AuthCheckTypePassword)
	})
}

func TestSession_Delete(t *testing.T) {
	repo := repository.NewSessionRepository(pool)
	tx, rollback := transactionForRollback(t)
	defer rollback()

	session, err := domain.NewSession("p-sess-del", nil)
	require.NoError(t, err)
	ensureProject(t, tx, session.ProjectID)
	require.NoError(t, repo.Create(t.Context(), tx, session))

	require.NoError(t, repo.Delete(t.Context(), tx, session.ProjectID, session.ID))
	_, err = repo.Get(t.Context(), tx, session.ProjectID, session.ID)
	require.ErrorIs(t, err, domain.ErrSessionNotFound())
}

func TestSession_Exchange_invalidToken(t *testing.T) {
	repo := repository.NewSessionRepository(pool)
	tx, rollback := transactionForRollback(t)
	defer rollback()

	ensureProject(t, tx, "p-invalid")
	_, err := repo.Exchange(t.Context(), tx, "p-invalid", "nope", nil, 0)
	require.ErrorIs(t, err, domain.ErrSessionInvalidHandoffToken())
}

func TestSession_Exchange_deletesAttempt(t *testing.T) {
	repo := repository.NewSessionRepository(pool)
	tx, rollback := transactionForRollback(t)
	defer rollback()

	projectID := "p-ex-del"
	plain, attempt := handoffCompletedAttempt(t, tx, projectID, nil)

	sess, err := repo.Exchange(t.Context(), tx, projectID, plain, nil, 0)
	require.NoError(t, err)
	require.NotEmpty(t, sess.ID)

	_, err = repository.NewAuthAttemptRepository(pool).GetByID(t.Context(), tx, projectID, attempt.ID)
	require.ErrorIs(t, err, domain.ErrAuthAttemptNotFound())
}

func TestSession_Exchange_conflictMissingSession(t *testing.T) {
	repo := repository.NewSessionRepository(pool)
	tx, rollback := transactionForRollback(t)
	defer rollback()

	projectID := "p-ex-conflict"
	missing := "999999"
	plain, _ := handoffCompletedAttempt(t, tx, projectID, func(a *domain.AuthAttempt) {
		a.SessionID = &missing
	})

	_, err := repo.Exchange(t.Context(), tx, projectID, plain, nil, 0)
	require.ErrorIs(t, err, domain.ErrSessionExchangeConflict())
}

func TestSession_Exchange_mergeChecks(t *testing.T) {
	repo := repository.NewSessionRepository(pool)

	t.Run("no_checks_yet", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		projectID := "p-merge-new"
		plain, attempt := handoffCompletedAttempt(t, tx, projectID, nil)

		sess, err := repo.Exchange(t.Context(), tx, projectID, plain, nil, 0)
		require.NoError(t, err)

		factors := sessionFactorsByType(sess)
		require.Contains(t, factors, domain.AuthCheckTypePassword)

		n := countChecks(t, tx,
			`SELECT COUNT(*) FROM `+repo.ChecksTable+` WHERE project_id = $1 AND session_id = $2`,
			projectID, database.Identity(sess.ID),
		)
		assert.Equal(t, int64(1), n)

		var authAttemptID database.Null[int64]
		err = tx.QueryRow(t.Context(),
			`SELECT auth_attempt_id FROM `+repo.ChecksTable+` WHERE project_id = $1 AND session_id = $2 LIMIT 1`,
			projectID, database.Identity(sess.ID),
		).Scan(&authAttemptID)
		require.NoError(t, err)
		assert.False(t, authAttemptID.Valid)

		_, err = repository.NewAuthAttemptRepository(pool).GetByID(t.Context(), tx, projectID, attempt.ID)
		require.ErrorIs(t, err, domain.ErrAuthAttemptNotFound())
	})

	t.Run("promote_multiple_types", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		projectID := "p-merge-multi"
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
		ensureProject(t, tx, projectID)
		require.NoError(t, repository.NewAuthAttemptRepository(pool).Create(t.Context(), tx, attempt))
		plain := "handoff_" + projectID
		attempt.HandoffToken = handoffTokenForTest(plain)
		require.NoError(t, repository.NewAuthAttemptRepository(pool).Handoff(t.Context(), tx, attempt))

		sess, err := repo.Exchange(t.Context(), tx, projectID, plain, nil, 0)
		require.NoError(t, err)
		factors := sessionFactorsByType(sess)
		assert.Len(t, factors, 2)
	})

	t.Run("unverified_not_promoted", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		projectID := "p-merge-unverified"
		attempt := &domain.AuthAttempt{
			ProjectID:      projectID,
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
			Checks:         []domain.AuthCheck{&domain.AuthFactorPassword{}},
		}
		ensureProject(t, tx, projectID)
		require.NoError(t, repository.NewAuthAttemptRepository(pool).Create(t.Context(), tx, attempt))
		require.NoError(t, repository.NewAuthAttemptRepository(pool).SetChallenge(t.Context(), tx, projectID, attempt.ID, &domain.AuthChallengePasskey{}))

		plain := "handoff_" + projectID
		attempt.HandoffToken = handoffTokenForTest(plain)
		require.NoError(t, repository.NewAuthAttemptRepository(pool).Handoff(t.Context(), tx, attempt))

		sess, err := repo.Exchange(t.Context(), tx, projectID, plain, nil, 0)
		require.NoError(t, err)
		assert.Len(t, sess.Factors, 1)

		n := countChecks(t, tx,
			`SELECT COUNT(*) FROM `+repo.ChecksTable+` WHERE project_id = $1 AND auth_attempt_id = $2`,
			projectID, database.Identity(attempt.ID),
		)
		assert.Equal(t, int64(0), n)

		challengeCount := countChecks(t, tx,
			`SELECT COUNT(*) FROM `+repo.ChecksTable+` WHERE project_id = $1 AND session_id = $2 AND type = $3`,
			projectID, database.Identity(sess.ID), int64(domain.AuthCheckTypePasskey),
		)
		assert.Equal(t, int64(0), challengeCount)
	})

	t.Run("overwrite_with_newer_attempt", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		projectID := "p-merge-overwrite"
		plain1, _ := handoffCompletedAttempt(t, tx, projectID, nil)
		sess, err := repo.Exchange(t.Context(), tx, projectID, plain1, nil, 0)
		require.NoError(t, err)

		oldVerified := time.Now().UTC().Add(-2 * time.Hour)
		_, err = tx.Exec(t.Context(),
			`UPDATE `+repo.ChecksTable+` SET last_verified_at = $1 WHERE project_id = $2 AND session_id = $3`,
			oldVerified, projectID, database.Identity(sess.ID),
		)
		require.NoError(t, err)

		attempt2 := &domain.AuthAttempt{
			ProjectID:      projectID,
			SessionID:      &sess.ID,
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
			Checks:         []domain.AuthCheck{&domain.AuthChallengePassword{}},
		}
		ensureProject(t, tx, projectID)
		require.NoError(t, repository.NewAuthAttemptRepository(pool).Create(t.Context(), tx, attempt2))
		challenge, ok := attempt2.ChallengeByType(domain.AuthCheckTypePassword)
		require.True(t, ok)
		require.NoError(t, repository.NewAuthAttemptRepository(pool).ChallengeSucceeded(t.Context(), tx, projectID, attempt2.ID, &domain.AuthFactorPassword{}, challenge.GetID()))

		plain2 := "handoff_" + projectID + "_2"
		attempt2.HandoffToken = handoffTokenForTest(plain2)
		require.NoError(t, repository.NewAuthAttemptRepository(pool).Handoff(t.Context(), tx, attempt2))

		updated, err := repo.Exchange(t.Context(), tx, projectID, plain2, nil, 0)
		require.NoError(t, err)
		assert.Equal(t, sess.ID, updated.ID)

		factor, ok := sessionFactorsByType(updated)[domain.AuthCheckTypePassword]
		require.True(t, ok)
		assert.True(t, factor.GetLastVerifiedAt().After(oldVerified))

		n := countChecks(t, tx,
			`SELECT COUNT(*) FROM `+repo.ChecksTable+` WHERE project_id = $1 AND session_id = $2 AND type = $3`,
			projectID, database.Identity(sess.ID), int64(domain.AuthCheckTypePassword),
		)
		assert.Equal(t, int64(1), n)
	})

	t.Run("keep_newer_session_factor", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		projectID := "p-merge-keep"
		plain1, _ := handoffCompletedAttempt(t, tx, projectID, nil)
		sess, err := repo.Exchange(t.Context(), tx, projectID, plain1, nil, 0)
		require.NoError(t, err)

		newer := time.Now().UTC()
		_, err = tx.Exec(t.Context(),
			`UPDATE `+repo.ChecksTable+` SET last_verified_at = $1 WHERE project_id = $2 AND session_id = $3`,
			newer, projectID, database.Identity(sess.ID),
		)
		require.NoError(t, err)

		attempt2 := &domain.AuthAttempt{
			ProjectID:      projectID,
			SessionID:      &sess.ID,
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
			Checks:         []domain.AuthCheck{&domain.AuthFactorPassword{}},
		}
		ensureProject(t, tx, projectID)
		require.NoError(t, repository.NewAuthAttemptRepository(pool).Create(t.Context(), tx, attempt2))
		_, err = tx.Exec(t.Context(),
			`UPDATE `+repo.ChecksTable+` SET last_verified_at = $1 WHERE project_id = $2 AND auth_attempt_id = $3`,
			newer.Add(-time.Hour), projectID, database.Identity(attempt2.ID),
		)
		require.NoError(t, err)

		plain2 := "handoff_" + projectID + "_keep"
		attempt2.HandoffToken = handoffTokenForTest(plain2)
		require.NoError(t, repository.NewAuthAttemptRepository(pool).Handoff(t.Context(), tx, attempt2))

		updated, err := repo.Exchange(t.Context(), tx, projectID, plain2, nil, 0)
		require.NoError(t, err)
		factor := sessionFactorsByType(updated)[domain.AuthCheckTypePassword]
		assert.True(t, factor.GetLastVerifiedAt().Equal(newer) || factor.GetLastVerifiedAt().After(newer.Add(-time.Second)))
	})

	t.Run("add_new_type_to_session", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		projectID := "p-merge-add-type"
		plain1, _ := handoffCompletedAttempt(t, tx, projectID, nil)
		sess, err := repo.Exchange(t.Context(), tx, projectID, plain1, nil, 0)
		require.NoError(t, err)

		attempt2 := &domain.AuthAttempt{
			ProjectID:      projectID,
			SessionID:      &sess.ID,
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePasskey},
			Checks:         []domain.AuthCheck{domain.SetAuthFactorPasskey(time.Now().UTC())},
		}
		ensureProject(t, tx, projectID)
		require.NoError(t, repository.NewAuthAttemptRepository(pool).Create(t.Context(), tx, attempt2))
		plain2 := "handoff_" + projectID + "_add"
		attempt2.HandoffToken = handoffTokenForTest(plain2)
		require.NoError(t, repository.NewAuthAttemptRepository(pool).Handoff(t.Context(), tx, attempt2))

		updated, err := repo.Exchange(t.Context(), tx, projectID, plain2, nil, 0)
		require.NoError(t, err)
		factors := sessionFactorsByType(updated)
		assert.Len(t, factors, 2)
		_, hasPassword := factors[domain.AuthCheckTypePassword]
		_, hasPasskey := factors[domain.AuthCheckTypePasskey]
		assert.True(t, hasPassword)
		assert.True(t, hasPasskey)
	})

	t.Run("user_id_from_user_factor", func(t *testing.T) {
		if isSpannerDB {
			t.Skip("user FK setup uses postgres-specific inserts in this test")
		}
		tx, rollback := transactionForRollback(t)
		defer rollback()

		const (
			projectID = "p-merge-userid"
			teamID    = "team-1"
			schemaURL = "https://schemas.test/sess.json"
			userID    = "usr_sess"
		)
		insertProjectTeamSchemaUser(t, tx, projectID, teamID, schemaURL, userID)

		attempt := &domain.AuthAttempt{
			ProjectID:      projectID,
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser},
			Checks:         []domain.AuthCheck{&domain.AuthFactorUser{UserID: userID}},
		}
		require.NoError(t, repository.NewAuthAttemptRepository(pool).Create(t.Context(), tx, attempt))
		plain := "handoff_" + projectID
		attempt.HandoffToken = handoffTokenForTest(plain)
		require.NoError(t, repository.NewAuthAttemptRepository(pool).Handoff(t.Context(), tx, attempt))

		sess, err := repo.Exchange(t.Context(), tx, projectID, plain, nil, 0)
		require.NoError(t, err)
		require.NotNil(t, sess.UserID)
		assert.Equal(t, userID, *sess.UserID)
	})
}

func TestSession_Exchange_ignoresIdempotencyKey(t *testing.T) {
	repo := repository.NewSessionRepository(pool)
	tx, rollback := transactionForRollback(t)
	defer rollback()

	projectID := "p-ex-idem"
	plain, _ := handoffCompletedAttempt(t, tx, projectID, nil)
	key := "retry-key"
	_, err := repo.Exchange(t.Context(), tx, projectID, plain, &key, 0)
	require.NoError(t, err)

	_, err = repo.Exchange(t.Context(), tx, projectID, plain, &key, 0)
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrSessionInvalidHandoffToken()))
}

func TestSession_Exchange_explicitTTL(t *testing.T) {
	repo := repository.NewSessionRepository(pool)
	tx, rollback := transactionForRollback(t)
	defer rollback()

	projectID := "p-ex-ttl"
	plain, _ := handoffCompletedAttempt(t, tx, projectID, nil)
	const ttl = 2 * time.Hour
	exchanged, err := repo.Exchange(t.Context(), tx, projectID, plain, nil, ttl)
	require.NoError(t, err)

	stored, err := repo.Get(t.Context(), tx, projectID, exchanged.ID)
	require.NoError(t, err)
	assert.Equal(t, ttl, stored.TimeToLive)
	assert.WithinDuration(t, stored.UpdatedAt.Add(stored.TimeToLive), stored.ExpiresAt, 2*time.Second)
}
