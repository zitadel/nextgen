package helpers

import (
	"testing"

	"github.com/stretchr/testify/require"
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

func (h *Harness) CreateTeam(t *testing.T, projectID string) string {
	t.Helper()
	team := &domain.Team{
		ProjectID: projectID,
	}

	pool := h.EnsureDBPool(t)
	repo := h.EnsureTeamRepo(t)

	err := repo.Create(t.Context(), pool, team)
	require.NoError(t, err)

	return team.ID
}
