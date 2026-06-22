//go:build postgres_integration || spanner_integration

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

func TestProjectRepository_Create(t *testing.T) {
	repo := repository.NewProjectRepository(pool)

	t.Run("creates project and timestamps are set", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		project := &domain.Project{ID: "proj-create-1"}
		require.NoError(t, repo.Create(t.Context(), tx, project))

		stored, err := repo.Get(t.Context(), tx, project.ID)
		require.NoError(t, err)
		assert.Equal(t, project.ID, stored.ID)
		assert.False(t, stored.CreatedAt.IsZero())
		assert.False(t, stored.UpdatedAt.IsZero())
		assert.WithinDuration(t, time.Now(), stored.CreatedAt, 5*time.Second)
		assert.WithinDuration(t, time.Now(), stored.UpdatedAt, 5*time.Second)
	})

	t.Run("duplicate ID returns error", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		project := &domain.Project{ID: "proj-dup"}
		require.NoError(t, repo.Create(t.Context(), tx, project))

		var err error
		if isSpannerDB {
			err = repo.Create(t.Context(), tx, project)
		} else {
			sp, spRollback := savepointForRollback(t, tx)
			err = repo.Create(t.Context(), sp, project)
			spRollback()
		}
		assert.Error(t, err)
	})
}

func TestProjectRepository_Get(t *testing.T) {
	repo := repository.NewProjectRepository(pool)

	t.Run("returns project by ID", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		project := &domain.Project{ID: "proj-get-1"}
		require.NoError(t, repo.Create(t.Context(), tx, project))

		stored, err := repo.Get(t.Context(), tx, project.ID)
		require.NoError(t, err)
		assert.Equal(t, "proj-get-1", stored.ID)
		assert.False(t, stored.CreatedAt.IsZero())
		assert.False(t, stored.UpdatedAt.IsZero())
	})

	t.Run("not found returns NoRowFoundError", func(t *testing.T) {
		tx, rollback := transactionForRollback(t)
		defer rollback()

		_, err := repo.Get(t.Context(), tx, "proj-nonexistent")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}
