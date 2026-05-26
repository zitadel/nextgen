package helpers

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/service"
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

func (h *Harness) EnsureProjectService(t *testing.T) service.ProjectService {
	t.Helper()
	if h.ProjectService == nil {
		h.ProjectService = service.NewProjectService(
			h.EnsureDBPool(t),
			h.EnsureProjectRepo(t),
			idgen.NewULID(),
		)
	}
	return h.ProjectService
}

func (h *Harness) CreateProject(t *testing.T, projectID string) string {
	t.Helper()
	project := &domain.Project{
		ID:        projectID,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	pool := h.EnsureDBPool(t)
	repo := repository.NewProjectRepository(pool)
	err := repo.Create(t.Context(), pool, project)
	require.NoError(t, err)
	return project.ID
}
