//go:build integration || spanner_integration

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

func TestTeamRepository_Create(t *testing.T) {
	repo := repository.NewTeamRepository(pool)

	t.Run("creates team and timestamps are set", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		ensureProject(t, tx, "proj-team-create-1")
		team := &domain.Team{ProjectID: "proj-team-create-1", ID: "team-create-1"}
		require.NoError(t, repo.Create(t.Context(), tx, team))

		stored, err := repo.Get(t.Context(), tx, team.ProjectID, team.ID)
		require.NoError(t, err)
		assert.Equal(t, team.ProjectID, stored.ProjectID)
		assert.Equal(t, team.ID, stored.ID)
		assert.False(t, stored.CreatedAt.IsZero())
		assert.False(t, stored.UpdatedAt.IsZero())
		assert.WithinDuration(t, time.Now(), stored.CreatedAt, 5*time.Second)
		assert.WithinDuration(t, time.Now(), stored.UpdatedAt, 5*time.Second)
	})

	t.Run("empty id returns error", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		ensureProject(t, tx, "proj-team-empty-id")
		team := &domain.Team{ProjectID: "proj-team-empty-id", ID: ""}

		var err error
		if isSpannerDB {
			err = repo.Create(t.Context(), tx, team)
		} else {
			sp, spRollback := savepointForRollback(t, tx)
			err = repo.Create(t.Context(), sp, team)
			spRollback()
		}
		assert.Error(t, err)
	})

	t.Run("duplicate (project_id, id) returns error", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		ensureProject(t, tx, "proj-team-dup")
		team := &domain.Team{ProjectID: "proj-team-dup", ID: "team-dup"}
		require.NoError(t, repo.Create(t.Context(), tx, team))

		var err error
		if isSpannerDB {
			err = repo.Create(t.Context(), tx, team)
		} else {
			sp, spRollback := savepointForRollback(t, tx)
			err = repo.Create(t.Context(), sp, team)
			spRollback()
		}
		assert.Error(t, err)
	})
}

func TestTeamRepository_Get(t *testing.T) {
	repo := repository.NewTeamRepository(pool)

	t.Run("returns team by project_id and id", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		ensureProject(t, tx, "proj-team-get-1")
		team := &domain.Team{ProjectID: "proj-team-get-1", ID: "team-get-1"}
		require.NoError(t, repo.Create(t.Context(), tx, team))

		stored, err := repo.Get(t.Context(), tx, team.ProjectID, team.ID)
		require.NoError(t, err)
		assert.Equal(t, "proj-team-get-1", stored.ProjectID)
		assert.Equal(t, "team-get-1", stored.ID)
		assert.False(t, stored.CreatedAt.IsZero())
		assert.False(t, stored.UpdatedAt.IsZero())
	})

	t.Run("not found returns NoRowFoundError", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		_, err := repo.Get(t.Context(), tx, "proj-nonexistent", "team-nonexistent")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}
