package helpers

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
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

func (h *Harness) CreateTeam(t *testing.T, projectID string, teamID string) string {
	t.Helper()
	team := &domain.Team{
		ProjectID: projectID,
		ID:        projectID,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	pool := h.EnsureDBPool(t)
	repo := h.EnsureTeamRepo(t)
	err := repo.Create(t.Context(), pool, team)
	require.NoError(t, err)
	return team.ID
}
