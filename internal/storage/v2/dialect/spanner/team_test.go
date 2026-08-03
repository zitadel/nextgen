//go:build spanner_integration

package spanner

import (
	"context"
	"strings"
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

func TestTeamStatements_UpdateTeam(t *testing.T) {
	ctx := t.Context()
	stmts := testClient.Statements()

	newProject := func(t *testing.T) *domain.Project {
		t.Helper()
		project := newTestProject(uniqueProjectID(t))
		require.NoError(t, stmts.CreateProject(ctx, project))
		t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), project.ID) })
		return project
	}

	t.Run("updates team", func(t *testing.T) {
		project := newProject(t)
		team := newTestTeam(project.ID, "team_v2_update")
		require.NoError(t, stmts.CreateTeam(ctx, team))
		createdAt, updatedAt := team.CreatedAt, team.UpdatedAt

		team.Name = "updated name"
		require.NoError(t, stmts.UpdateTeam(ctx, team))
		assert.Equal(t, "updated name", team.Name)
		assert.Equal(t, domain.TeamStatusActive, team.Status)
		assert.Equal(t, createdAt, team.CreatedAt)
		assert.True(t, team.UpdatedAt.After(updatedAt))
	})

	t.Run("team not found returns NoRowFoundError", func(t *testing.T) {
		project := newProject(t)
		assert.ErrorIs(t,
			stmts.UpdateTeam(ctx, newTestTeam(project.ID, "missing")),
			new(database.NoRowFoundError),
		)
	})

	t.Run("deactivated team returns NoRowFoundError", func(t *testing.T) {
		project := newProject(t)
		team := newTestTeam(project.ID, "team_v2_update_deactivated")
		require.NoError(t, stmts.CreateTeam(ctx, team))
		require.NoError(t, stmts.DeactivateTeam(ctx, project.ID, team.ID))

		team.Name = "updated name"
		assert.ErrorIs(t,
			stmts.UpdateTeam(ctx, team),
			new(database.NoRowFoundError),
		)
	})

	t.Run("name violates uniqueness constraint", func(t *testing.T) {
		project := newProject(t)
		team := newTestTeam(project.ID, "team_v2_update_rename")
		require.NoError(t, stmts.CreateTeam(ctx, team))

		taken := newTestTeam(project.ID, "team_v2_update_taken")
		require.NoError(t, stmts.CreateTeam(ctx, taken))

		team.Name = taken.Name
		assert.ErrorIs(t, stmts.UpdateTeam(ctx, team), new(database.UniqueError))

		// a case-only difference still collides.
		team.Name = strings.ToUpper(taken.Name)
		assert.ErrorIs(t, stmts.UpdateTeam(ctx, team), new(database.UniqueError))
	})

	t.Run("unchanged name", func(t *testing.T) {
		project := newProject(t)
		team := newTestTeam(project.ID, "team_v2_update_same_name")
		require.NoError(t, stmts.CreateTeam(ctx, team))
		name := team.Name

		// The row already holds the name it is updated to, so the unique index
		// must not read it as a collision.
		require.NoError(t, stmts.UpdateTeam(ctx, team))
		assert.Equal(t, name, team.Name)
	})

	t.Run("same name in another project", func(t *testing.T) {
		project := newProject(t)
		team := newTestTeam(project.ID, "team_v2_update_src")
		require.NoError(t, stmts.CreateTeam(ctx, team))

		other := newProject(t)
		otherTeam := newTestTeam(other.ID, "team_v2_update_dst")
		require.NoError(t, stmts.CreateTeam(ctx, otherTeam))

		otherTeam.Name = team.Name
		require.NoError(t, stmts.UpdateTeam(ctx, otherTeam))
		assert.Equal(t, team.Name, otherTeam.Name)
	})
}

func TestTeamStatements_NameUniquePerProject(t *testing.T) {
	ctx := t.Context()
	stmts := testClient.Statements()

	project := newTestProject(uniqueProjectID(t))
	require.NoError(t, stmts.CreateProject(ctx, project))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), project.ID) })

	other := newTestProject(uniqueProjectID(t))
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

func TestTeamStatements_NameColumnConstraints(t *testing.T) {
	ctx := t.Context()
	stmts := testClient.Statements()

	project := newTestProject(uniqueProjectID(t))
	require.NoError(t, stmts.CreateProject(ctx, project))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), project.ID) })

	t.Run("empty", func(t *testing.T) {
		team := newTestTeam(project.ID, "team_v2_name_empty")
		team.Name = ""
		assert.ErrorIs(t, stmts.CreateTeam(ctx, team), new(database.CheckError))
	})

	t.Run("over the length limit", func(t *testing.T) {
		team := newTestTeam(project.ID, "team_v2_name_long")
		team.Name = strings.Repeat("a", domain.TeamNameMaxLength+1)
		assert.ErrorIs(t, stmts.CreateTeam(ctx, team), new(database.CheckError))
	})
}
