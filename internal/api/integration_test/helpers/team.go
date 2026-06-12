package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureTeamRepo(t *testing.T) domain.TeamRepository {
	t.Helper()
	h.mu.Lock()
	repo := h.TeamRepo
	h.mu.Unlock()
	if repo != nil {
		return repo
	}
	repo = repository.NewTeamRepository(
		h.EnsureDBPool(t),
	)
	h.mu.Lock()
	if h.TeamRepo == nil {
		h.TeamRepo = repo
	}
	repo = h.TeamRepo
	h.mu.Unlock()
	return repo
}

func (h *Harness) EnsureTeamService(t *testing.T) *service.TeamService {
	t.Helper()
	h.mu.Lock()
	svc := h.TeamService
	h.mu.Unlock()
	if svc != nil {
		return svc
	}
	svc = service.NewTeamService(
		h.EnsureDBPool(t),
		h.EnsureTeamRepo(t),
	)
	h.mu.Lock()
	if h.TeamService == nil {
		h.TeamService = svc
	}
	svc = h.TeamService
	h.mu.Unlock()
	return svc
}
