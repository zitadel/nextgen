package helpers

import (
	"testing"

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
