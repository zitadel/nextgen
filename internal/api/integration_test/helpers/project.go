package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
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
			h.ServiceDB(t),
			h.EnsureProjectRepo(t),
			h.EnsureSchemaRepo(t),
			h.EnsureFlowDefinitionRepo(t),
			h.EnsureOpaqueTokenGenerator(t),
			BuiltinSchemaBaseURL,
			h.EnsureSchemaValidator(t),
		)
	}
	return h.ProjectService
}
