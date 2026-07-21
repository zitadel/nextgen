//go:build postgres_integration

package postgres

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	legacydb "github.com/zitadel/nextgen/internal/storage/database"
)

func uniqueTeamIDs(t *testing.T) (projectID, teamID string) {
	t.Helper()
	suffix := strings.ReplaceAll(t.Name(), "/", "_") + "-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	return "proj-team-" + suffix, "team-" + suffix
}

func ensureTestProject(t *testing.T, projectID string) {
	t.Helper()
	project := newTestProject(projectID)
	require.NoError(t, testPool.CreateProject(t.Context(), project))
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })
}

func TestTeamStatements_Create(t *testing.T) {
	t.Run("creates team and timestamps are set", func(t *testing.T) {
		projectID, teamID := uniqueTeamIDs(t)
		ensureTestProject(t, projectID)

		team := &domain.Team{ProjectID: projectID, ID: teamID}
		require.NoError(t, testPool.CreateTeam(t.Context(), team))
		assert.Equal(t, domain.TeamStatusActive, team.Status)
		assert.False(t, team.CreatedAt.IsZero())
		assert.False(t, team.UpdatedAt.IsZero())
		assert.WithinDuration(t, time.Now(), team.CreatedAt, 5*time.Second)

		stored, err := testPool.GetTeamByID(t.Context(), projectID, teamID)
		require.NoError(t, err)
		assert.Equal(t, projectID, stored.ProjectID)
		assert.Equal(t, teamID, stored.ID)
		assert.Equal(t, domain.TeamStatusActive, stored.Status)
	})

	t.Run("empty id returns error", func(t *testing.T) {
		projectID, _ := uniqueTeamIDs(t)
		ensureTestProject(t, projectID)

		err := testPool.CreateTeam(t.Context(), &domain.Team{ProjectID: projectID, ID: ""})
		assert.Error(t, err)
	})

	t.Run("duplicate (project_id, id) returns error", func(t *testing.T) {
		projectID, teamID := uniqueTeamIDs(t)
		ensureTestProject(t, projectID)

		team := &domain.Team{ProjectID: projectID, ID: teamID}
		require.NoError(t, testPool.CreateTeam(t.Context(), team))

		err := testPool.CreateTeam(t.Context(), &domain.Team{ProjectID: projectID, ID: teamID})
		assert.Error(t, err)
	})
}

func TestTeamStatements_Get(t *testing.T) {
	t.Run("returns team by project_id and id", func(t *testing.T) {
		projectID, teamID := uniqueTeamIDs(t)
		ensureTestProject(t, projectID)
		require.NoError(t, testPool.CreateTeam(t.Context(), &domain.Team{ProjectID: projectID, ID: teamID}))

		stored, err := testPool.GetTeamByID(t.Context(), projectID, teamID)
		require.NoError(t, err)
		assert.Equal(t, projectID, stored.ProjectID)
		assert.Equal(t, teamID, stored.ID)
		assert.False(t, stored.CreatedAt.IsZero())
	})

	t.Run("not found returns NoRowFoundError", func(t *testing.T) {
		_, err := testPool.GetTeamByID(t.Context(), "proj-nonexistent", "team-nonexistent")
		assert.ErrorIs(t, err, new(legacydb.NoRowFoundError))
	})
}

func TestTeamStatements_Deactivate(t *testing.T) {
	projectID, teamID := uniqueTeamIDs(t)
	ensureTestProject(t, projectID)
	require.NoError(t, testPool.CreateTeam(t.Context(), &domain.Team{ProjectID: projectID, ID: teamID}))

	require.NoError(t, testPool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		return tx.Statements().DeactivateTeam(ctx, projectID, teamID)
	}))

	stored, err := testPool.GetTeamByID(t.Context(), projectID, teamID)
	require.NoError(t, err)
	assert.Equal(t, domain.TeamStatusDeactivated, stored.Status)
}
