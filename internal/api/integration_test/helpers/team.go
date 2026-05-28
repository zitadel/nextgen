package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureTeamRepo(t *testing.T) domain.TeamRepository {
	t.Helper()
	if h.TeamRepo == nil {
		h.TeamRepo = repository.NewTeamRepository(
			h.EnsureDBPool(t),
		)
	}

	return h.TeamRepo
}

func (h *Harness) EnsureTeamService(t *testing.T) *service.TeamService {
	t.Helper()
	if h.TeamService == nil {
		h.TeamService = service.NewTeamService(
			h.EnsureDBPool(t),
			h.EnsureTeamRepo(t),
		)
	}
	return h.TeamService
}
