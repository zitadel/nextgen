package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureProjectRepo(t *testing.T) domain.ProjectRepository {
	t.Helper()
	h.mu.Lock()
	repo := h.ProjectRepo
	h.mu.Unlock()
	if repo != nil {
		return repo
	}
	repo = repository.NewProjectRepository(
		h.EnsureDBPool(t),
	)
	h.mu.Lock()
	if h.ProjectRepo == nil {
		h.ProjectRepo = repo
	}
	repo = h.ProjectRepo
	h.mu.Unlock()
	return repo
}

func (h *Harness) EnsureProjectService(t *testing.T) service.ProjectService {
	t.Helper()
	h.mu.Lock()
	svc := h.ProjectService
	h.mu.Unlock()
	if svc != nil {
		return svc
	}
	svc = service.NewProjectService(
		h.EnsureDBPool(t),
		h.EnsureProjectRepo(t),
		h.EnsureSchemaRepo(t),
		h.EnsureFlowDefinitionRepo(t),
		h.EnsureSecretGenerator(t),
		BuiltinSchemaBaseURL,
		h.EnsureSchemaValidator(t),
	)
	h.mu.Lock()
	if h.ProjectService == nil {
		h.ProjectService = svc
	}
	svc = h.ProjectService
	h.mu.Unlock()
	return svc
}
