//go:build spanner_integration

package spanner

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestTeamStatements_CRUD(t *testing.T) {
	ctx := t.Context()
	stmts := testClient.Statements()

	project := newTestProject(uniqueProjectID(t))
	require.NoError(t, stmts.CreateProject(ctx, project))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), project.ID) })

	team := newTestTeam(project.ID, "team_v2_crud")
	require.NoError(t, stmts.CreateTeam(ctx, team))
	assert.Equal(t, domain.TeamStatusActive, team.Status)
	assert.False(t, team.CreatedAt.IsZero())
	assert.False(t, team.UpdatedAt.IsZero())

	got, err := stmts.GetTeamByID(ctx, project.ID, team.ID)
	require.NoError(t, err)
	assert.Equal(t, team.ID, got.ID)
	assert.Equal(t, project.ID, got.ProjectID)
	assert.Equal(t, team.Name, got.Name)
	assert.Equal(t, domain.TeamStatusActive, got.Status)

	require.NoError(t, stmts.DeactivateTeam(ctx, project.ID, team.ID))

	got, err = stmts.GetTeamByID(ctx, project.ID, team.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.TeamStatusDeactivated, got.Status)

	_, err = stmts.GetTeamByID(ctx, project.ID, "missing")
	require.Error(t, err)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestTeamStatements_NameUniquePerProject(t *testing.T) {
	ctx := t.Context()
	stmts := testClient.Statements()

	project := newTestProject(uniqueProjectID(t))
	require.NoError(t, stmts.CreateProject(ctx, project))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), project.ID) })

	other := newTestProject(uniqueProjectID(t) + "_other")
	require.NoError(t, stmts.CreateProject(ctx, other))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), other.ID) })

	team := newTestTeam(project.ID, "team_v2_unique")
	require.NoError(t, stmts.CreateTeam(ctx, team))

	duplicate := newTestTeam(project.ID, "team_v2_unique_2")
	duplicate.Name = team.Name
	assert.ErrorIs(t, stmts.CreateTeam(ctx, duplicate), new(database.UniqueError))

	differentCase := newTestTeam(project.ID, "team_v2_unique_3")
	differentCase.Name = strings.ToUpper(team.Name)
	assert.ErrorIs(t, stmts.CreateTeam(ctx, differentCase), new(database.UniqueError))

	sameNameOtherProject := newTestTeam(other.ID, "team_v2_unique")
	sameNameOtherProject.Name = team.Name
	require.NoError(t, stmts.CreateTeam(ctx, sameNameOtherProject))
}
