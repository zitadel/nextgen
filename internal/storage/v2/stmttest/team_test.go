//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestTeamStatements_GetByID(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("returns_created_team", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			teamID := "team-" + uniqueSuffix(t)
			team := newTestTeam(projectID, teamID)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			assert.Equal(t, domain.TeamStatusActive, team.Status)

			got, err := d.stmts.GetTeamByID(t.Context(), projectID, teamID)
			require.NoError(t, err)
			assert.Equal(t, projectID, got.ProjectID)
			assert.Equal(t, teamID, got.ID)
			assert.Equal(t, team.Name, got.Name)
			assert.Equal(t, domain.TeamStatusActive, got.Status)
			assert.False(t, got.CreatedAt.IsZero())
			assert.False(t, got.UpdatedAt.IsZero())
		})

		t.Run("missing_returns_NoRowFoundError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			_, err := d.stmts.GetTeamByID(t.Context(), projectID, "missing-team")
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})
	})
}

func TestTeamStatements_UpdateTeam(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("updates_name_and_timestamps", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			team := newTestTeam(projectID, "team-"+uniqueSuffix(t))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			createdAt, updatedAt := team.CreatedAt, team.UpdatedAt

			team.Name = "updated name " + uniqueSuffix(t)
			require.NoError(t, d.stmts.UpdateTeam(t.Context(), team))
			assert.Equal(t, projectID, team.ProjectID)
			assert.Equal(t, domain.TeamStatusActive, team.Status)
			assert.Equal(t, createdAt, team.CreatedAt)
			assert.True(t, team.UpdatedAt.After(updatedAt) || team.UpdatedAt.Equal(updatedAt))
		})

		t.Run("missing_returns_NoRowFoundError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			team := newTestTeam(projectID, "missing-"+uniqueSuffix(t))
			assert.ErrorIs(t, d.stmts.UpdateTeam(t.Context(), team), new(database.NoRowFoundError))
		})

		t.Run("deactivated_returns_NoRowFoundError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			teamID := "team-" + uniqueSuffix(t)
			team := newTestTeam(projectID, teamID)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			require.NoError(t, d.stmts.DeactivateTeam(t.Context(), projectID, teamID))

			team.Name = "updated name"
			assert.ErrorIs(t, d.stmts.UpdateTeam(t.Context(), team), new(database.NoRowFoundError))
		})

		t.Run("duplicate_name_returns_UniqueError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			team := newTestTeam(projectID, "team-"+uniqueSuffix(t))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

			taken := newTestTeam(projectID, "team-"+uniqueSuffix(t))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), taken))

			team.Name = taken.Name
			assert.ErrorIs(t, d.stmts.UpdateTeam(t.Context(), team), new(database.UniqueError))

			team.Name = strings.ToUpper(taken.Name)
			assert.ErrorIs(t, d.stmts.UpdateTeam(t.Context(), team), new(database.UniqueError))
		})

		t.Run("unchanged_name_ok", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			team := newTestTeam(projectID, "team-"+uniqueSuffix(t))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			name := team.Name
			require.NoError(t, d.stmts.UpdateTeam(t.Context(), team))
			assert.Equal(t, name, team.Name)
		})

		t.Run("same_name_other_project_ok", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			team := newTestTeam(projectID, "team-"+uniqueSuffix(t))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

			otherProjectID := ensureProject(t, d.stmts)
			other := newTestTeam(otherProjectID, "team-"+uniqueSuffix(t))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), other))

			other.Name = team.Name
			require.NoError(t, d.stmts.UpdateTeam(t.Context(), other))
			assert.Equal(t, team.Name, other.Name)
		})
	})
}
