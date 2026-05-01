package repository_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func newTestSession(projectID, sessionID, token string) *domain.Session {
	expiresAt := time.Now().Add(10 * time.Minute).UTC()
	return &domain.Session{
		ProjectID: projectID,
		ID:        sessionID,
		Token:     token,
		ExpiresAt: expiresAt,
		UserAgent: map[string]any{"browser": "safari", "platform": "macos"},
		Factors: []*domain.SessionFactor{
			{
				Type:       domain.AuthCheckTypePassword,
				VerifiedAt: time.Now().UTC().Truncate(time.Second),
				Factor: map[string]any{
					"method": "password",
				},
			},
		},
	}
}

func TestSession_CreateAndGet(t *testing.T) {
	repo := new(repository.Session)

	t.Run("create stores and get by id returns session", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		session := newTestSession("project-create", "session-create", "stok-create")
		ensureProject(t, tx, session.ProjectID)

		require.NoError(t, repo.Create(t.Context(), tx, session))
		assert.False(t, session.CreatedAt.IsZero())
		assert.False(t, session.UpdatedAt.IsZero())

		stored, err := repo.GetByID(t.Context(), tx, session.ProjectID, session.ID)
		require.NoError(t, err)
		assert.Equal(t, session.ProjectID, stored.ProjectID)
		assert.Equal(t, session.ID, stored.ID)
		assert.Equal(t, session.Token, stored.Token)
		assert.Equal(t, session.ExpiresAt.Unix(), stored.ExpiresAt.Unix())
		assert.Equal(t, "safari", stored.UserAgent["browser"])
		require.Len(t, stored.Factors, 1)
		assert.Equal(t, domain.AuthCheckTypePassword, stored.Factors[0].Type)
		payload, ok := stored.Factors[0].Factor.(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "password", payload["method"])
	})

	t.Run("get by token resolves row", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		session := newTestSession("project-by-token", "session-by-token", "stok-by-token")
		ensureProject(t, tx, session.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, session))

		stored, err := repo.GetByToken(t.Context(), tx, session.ProjectID, session.Token)
		require.NoError(t, err)
		assert.Equal(t, session.ID, stored.ID)
		assert.Equal(t, session.Token, stored.Token)
	})

	t.Run("missing get returns empty aggregate", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		stored, err := repo.GetByID(t.Context(), tx, "missing-project", "missing-session")
		require.NoError(t, err)
		assert.Empty(t, stored.ProjectID)
		assert.Empty(t, stored.ID)
		assert.Empty(t, stored.Token)
	})

	t.Run("duplicate token in same project fails", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		ensureProject(t, tx, "project-dup-token")
		first := newTestSession("project-dup-token", "session-one", "stok-dup")
		second := newTestSession("project-dup-token", "session-two", "stok-dup")
		require.NoError(t, repo.Create(t.Context(), tx, first))

		sp, spRollback := savepointForRollback(t, tx)
		err := repo.Create(t.Context(), sp, second)
		spRollback()
		require.Error(t, err)
		var uniqueErr *database.UniqueError
		assert.ErrorAs(t, err, &uniqueErr)
	})
}

func TestSession_Update(t *testing.T) {
	repo := new(repository.Session)

	t.Run("updates supported fields and persists caller token", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		session := newTestSession("project-update", "session-update", "stok-before")
		ensureProject(t, tx, session.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, session))
		createdUpdatedAt := session.UpdatedAt

		updated, err := repo.Update(
			t.Context(),
			tx,
			session.ProjectID,
			session.ID,
			"stok-after",
			repo.SetExpiresAt(time.Now().Add(24*time.Hour).UTC()),
			repo.SetUserAgent(map[string]any{"browser": "firefox", "platform": "linux"}),
			repo.SetFactors(&domain.SessionFactor{Type: domain.AuthCheckTypePasskey, VerifiedAt: time.Now().UTC().Truncate(time.Second), Factor: map[string]any{"user_verified": true}}),
		)
		require.NoError(t, err)

		assert.Equal(t, "stok-after", updated.Token)
		assert.Equal(t, "firefox", updated.UserAgent["browser"])
		require.Len(t, updated.Factors, 1)
		assert.Equal(t, domain.AuthCheckTypePasskey, updated.Factors[0].Type)
		assert.True(t, updated.UpdatedAt.After(createdUpdatedAt) || updated.UpdatedAt.Equal(createdUpdatedAt))

		stale, err := repo.GetByToken(t.Context(), tx, session.ProjectID, "stok-before")
		require.NoError(t, err)
		assert.Empty(t, stale.ID)

		resolved, err := repo.GetByToken(t.Context(), tx, session.ProjectID, "stok-after")
		require.NoError(t, err)
		assert.Equal(t, session.ID, resolved.ID)
	})

	t.Run("unsupported change returns error", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		session := newTestSession("project-update-invalid", "session-update-invalid", "stok-update-invalid")
		ensureProject(t, tx, session.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, session))

		_, err := repo.Update(
			t.Context(),
			tx,
			session.ProjectID,
			session.ID,
			"stok-next",
			database.NewChange(database.NewColumn("zitadel_nextgen.sessions", "created_at"), time.Now().UTC()),
		)
		require.Error(t, err)
	})

	t.Run("no changes returns error", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		session := newTestSession("project-update-no-change", "session-update-no-change", "stok-update-no-change")
		ensureProject(t, tx, session.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, session))

		_, err := repo.Update(t.Context(), tx, session.ProjectID, session.ID, "stok-next")
		require.Error(t, err)
	})
}

func TestSession_Delete(t *testing.T) {
	repo := new(repository.Session)

	t.Run("delete existing session", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		session := newTestSession("project-delete", "session-delete", "stok-delete")
		ensureProject(t, tx, session.ProjectID)
		require.NoError(t, repo.Create(t.Context(), tx, session))

		require.NoError(t, repo.Delete(t.Context(), tx, session.ProjectID, session.ID))

		stored, err := repo.GetByID(t.Context(), tx, session.ProjectID, session.ID)
		require.NoError(t, err)
		assert.Empty(t, stored.ID)
	})

	t.Run("delete missing is no-op", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		err := repo.Delete(t.Context(), tx, "missing-project", "missing-session")
		require.NoError(t, err)
	})
}
