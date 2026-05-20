//go:build integration

package helpers

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureProjectRepo(t *testing.T) domain.ProjectRepository {
	t.Helper()
	if h.ProjectRepo == nil {
		h.ProjectRepo = repository.NewProjectRepository(
			h.EnsureDBPool(t),
		)
	}

	return h.ProjectRepo
}

func (h *Harness) WithProject(t *testing.T) *domain.Project {
	t.Helper()
	if h.Project == nil {
		project := &domain.Project{
			ID:        "prj_test_1",
			CreatedAt: time.Now().UTC(),
			UpdatedAt: time.Now().UTC(),
		}
		pool := h.EnsureDBPool(t)
		repo := repository.NewProjectRepository(pool)
		err := repo.Create(t.Context(), pool, project)
		require.NoError(t, err)

		h.Project = project
	}
	return h.Project
}
