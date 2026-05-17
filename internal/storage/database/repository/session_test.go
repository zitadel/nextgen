package repository_test

import (
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func ensureProjectTeamSchemaUser(t *testing.T, client database.QueryExecutor, pid, tid, schemaURL, userID string) {
	t.Helper()
	ctx := t.Context()
	ensureProject(t, client, pid)
	_, err := client.Exec(ctx, `INSERT INTO zitadel_nextgen.teams (project_id, id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, pid, tid)
	require.NoError(t, err)
	_, err = client.Exec(ctx,
		`INSERT INTO zitadel_nextgen.json_schemas (project_id, url, payload) VALUES ($1,$2,$3::json) ON CONFLICT DO NOTHING`,
		pid, schemaURL, []byte("{}"),
	)
	require.NoError(t, err)
	_, err = client.Exec(ctx,
		`INSERT INTO zitadel_nextgen.users (project_id, schema_url, id, team_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
		pid, schemaURL, userID, tid,
	)
	require.NoError(t, err)
}

func newTestSession(projectID, sessionID, token string) *domain.Session {
	expiresAt := time.Now().Add(10 * time.Minute).UTC()
	return &domain.Session{
		ProjectID: projectID,
		ID:        sessionID,
		Token:     token,
		ExpiresAt: expiresAt,
		UserAgent: &domain.UserAgent{
			ID:   "ua-" + sessionID,
			Info: map[string]any{"browser": "safari", "platform": "macos"},
		},
	}
}

func sessionRepo(t *testing.T, tx database.QueryExecutor) domain.SessionRepository {
	t.Helper()
	var beginner database.Beginner = pool
	if b, ok := tx.(database.Beginner); ok {
		beginner = b
	}
	return repository.NewSessionRepositoryForTest(tx, beginner, repository.NewAuthAttemptRepository(pool))
}

func TestSession_CreateAndGet(t *testing.T) {
	t.Run("create stores and get by id returns session", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()
		repo := sessionRepo(t, tx)

		session := newTestSession("project-create", "session-create", "stok-create")
		ensureProject(t, tx, session.ProjectID)

		require.NoError(t, repo.Create(t.Context(), session))
		assert.False(t, session.CreatedAt.IsZero())

		stored, err := repo.GetByID(t.Context(), session.ProjectID, session.ID)
		require.NoError(t, err)
		assert.Equal(t, session.ID, stored.ID)
		assert.Equal(t, session.Token, stored.Token)
		require.NotNil(t, stored.UserAgent)
		assert.Equal(t, "safari", stored.UserAgent.Info["browser"])
	})

	t.Run("get by token resolves row", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()
		repo := sessionRepo(t, tx)

		session := newTestSession("project-by-token", "session-by-token", "stok-by-token")
		ensureProject(t, tx, session.ProjectID)
		require.NoError(t, repo.Create(t.Context(), session))

		stored, err := repo.GetByToken(t.Context(), session.ProjectID, session.Token)
		require.NoError(t, err)
		assert.Equal(t, session.ID, stored.ID)
	})

	t.Run("not found returns NoRowFoundError", func(t *testing.T) {
		repo := repository.NewSessionRepository(pool, repository.NewAuthAttemptRepository(pool))
		_, err := repo.GetByID(t.Context(), "missing-project", "missing-session")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})

	t.Run("duplicate token in same project fails", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()
		repo := sessionRepo(t, tx)

		ensureProject(t, tx, "project-dup-token")
		first := newTestSession("project-dup-token", "session-one", "stok-dup")
		second := newTestSession("project-dup-token", "session-two", "stok-dup")
		require.NoError(t, repo.Create(t.Context(), first))

		_, spRollback := savepointForRollback(t, tx)
		err := repo.Create(t.Context(), second)
		spRollback()
		require.Error(t, err)
		var uniqueErr *database.UniqueError
		assert.ErrorAs(t, err, &uniqueErr)
	})
}

func TestSession_Delete(t *testing.T) {
	t.Run("delete existing session", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()
		repo := sessionRepo(t, tx)

		session := newTestSession("project-delete", "session-delete", "stok-delete")
		ensureProject(t, tx, session.ProjectID)
		require.NoError(t, repo.Create(t.Context(), session))

		require.NoError(t, repo.Delete(t.Context(), session.ProjectID, session.ID))

		_, err := repo.GetByID(t.Context(), session.ProjectID, session.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})

	t.Run("delete missing is no-op", func(t *testing.T) {
		repo := repository.NewSessionRepository(pool, repository.NewAuthAttemptRepository(pool))
		err := repo.Delete(t.Context(), "missing-project", "missing-session")
		require.NoError(t, err)
	})
}

func TestSession_MergeAttempt(t *testing.T) {
	sessRepo := repository.NewSessionRepository(pool, repository.NewAuthAttemptRepository(pool))
	attemptRepo := repository.NewAuthAttemptRepository(pool)

	t.Run("merges handed-off password check into session", func(t *testing.T) {
		projectID := "p-merge"
		ensureProject(t, pool, projectID)

		session := newTestSession(projectID, "sess-merge", "stok-merge")
		require.NoError(t, sessRepo.Create(t.Context(), session))

		check := &domain.PasswordAuthCheck{AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePassword}}
		attempt := &domain.AuthAttempt{
			ProjectID:      projectID,
			ID:             "attempt-merge",
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
			Checks:         []domain.AuthChecker{check},
		}
		require.NoError(t, attemptRepo.Create(t.Context(), pool, attempt))
		require.NoError(t, attemptRepo.ChallengeSucceeded(t.Context(), pool, projectID, attempt.ID, check))

		token := "handoff-merge"
		attempt.HandoffToken = &token
		require.NoError(t, attemptRepo.Handoff(t.Context(), pool, attempt))

		merged, err := sessRepo.MergeAttempt(t.Context(), projectID, session.ID, token)
		require.NoError(t, err)
		require.NotEmpty(t, merged.Token)
		assert.NotEqual(t, session.Token, merged.Token)
		require.Len(t, merged.Factors, 1)
		assert.Equal(t, domain.AuthCheckTypePassword, merged.Factors[0].Type)

		storedAttempt, err := attemptRepo.GetByID(t.Context(), pool, projectID, attempt.ID)
		require.NoError(t, err)
		assert.Empty(t, storedAttempt.ID)
	})

	t.Run("merge resets credential failed_attempts when check is bound to user password", func(t *testing.T) {
		const (
			projectID = "p-merge-cred"
			teamID    = "team-merge-cred"
			schemaURL = "https://schemas.test/merge-cred.json"
			userID    = "user-merge-cred"
		)
		ensureProjectTeamSchemaUser(t, pool, projectID, teamID, schemaURL, userID)

		pwRepo := repository.NewUserPasswordRepository()
		require.NoError(t, pwRepo.Create(t.Context(), pool, &domain.CreateUserPassword{
			ProjectID:      projectID,
			UserID:         userID,
			EncodedHash:    "argon2id$v=19$m=65536,t=3,p=4$fake",
			ChangeRequired: false,
		}))
		password, err := pwRepo.Get(t.Context(), pool, database.WithCondition(pwRepo.UniqueCondition(projectID, userID)))
		require.NoError(t, err)

		_, err = pool.Exec(t.Context(),
			`UPDATE zitadel_nextgen.user_passwords SET failed_attempts = 5 WHERE id = $1`,
			password.ID,
		)
		require.NoError(t, err)

		session := newTestSession(projectID, "sess-merge-cred", "stok-merge-cred")
		require.NoError(t, sessRepo.Create(t.Context(), session))

		check := &domain.PasswordAuthCheck{AuthCheck: &domain.AuthCheck{Type: domain.AuthCheckTypePassword}}
		attempt := &domain.AuthAttempt{
			ProjectID:      projectID,
			ID:             "attempt-merge-cred",
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
			Checks:         []domain.AuthChecker{check},
		}
		require.NoError(t, attemptRepo.Create(t.Context(), pool, attempt))
		require.NoError(t, attemptRepo.ChallengeSucceeded(t.Context(), pool, projectID, attempt.ID, check))

		checkID := projectID + ":" + attempt.ID + ":" + strconv.Itoa(int(domain.AuthCheckTypePassword))
		_, err = pool.Exec(t.Context(),
			`UPDATE zitadel_nextgen.checks SET user_password_id = $1 WHERE project_id = $2 AND id = $3`,
			password.ID, projectID, checkID,
		)
		require.NoError(t, err)

		token := "handoff-merge-cred"
		attempt.HandoffToken = &token
		require.NoError(t, attemptRepo.Handoff(t.Context(), pool, attempt))

		_, err = sessRepo.MergeAttempt(t.Context(), projectID, session.ID, token)
		require.NoError(t, err)

		after, err := pwRepo.Get(t.Context(), pool, database.WithCondition(pwRepo.PrimaryKeyCondition(password.ID)))
		require.NoError(t, err)
		assert.Equal(t, int16(0), after.FailedAttempts)
	})
}
