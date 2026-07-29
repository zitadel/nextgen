//go:build spanner_integration

package spanner

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestTeamStatements_CRUD(t *testing.T) {
	ctx := t.Context()
	stmts := testClient.Statements()

	project := newTestProject(uniqueProjectID(t))
	require.NoError(t, stmts.CreateProject(ctx, project))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), project.ID) })

	team := &domain.Team{ProjectID: project.ID, ID: "team_v2_crud"}
	require.NoError(t, stmts.CreateTeam(ctx, team))
	assert.Equal(t, domain.TeamStatusActive, team.Status)
	assert.False(t, team.CreatedAt.IsZero())
	assert.False(t, team.UpdatedAt.IsZero())

	got, err := stmts.GetTeamByID(ctx, project.ID, team.ID)
	require.NoError(t, err)
	assert.Equal(t, team.ID, got.ID)
	assert.Equal(t, project.ID, got.ProjectID)
	assert.Equal(t, domain.TeamStatusActive, got.Status)

	require.NoError(t, stmts.DeactivateTeam(ctx, project.ID, team.ID))

	got, err = stmts.GetTeamByID(ctx, project.ID, team.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.TeamStatusDeactivated, got.Status)

	_, err = stmts.GetTeamByID(ctx, project.ID, "missing")
	require.Error(t, err)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}
