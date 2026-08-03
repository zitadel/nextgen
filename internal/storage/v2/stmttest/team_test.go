//go:build postgres_integration || spanner_integration

package stmttest

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func uniqueTeamID(t *testing.T) string {
	t.Helper()
	return "team-" + uniqueSuffix(t)
}

// ensureTeamTestProject creates the project teams hang off. Teams need no
// cleanup of their own: both dialects declare the project FK ON DELETE CASCADE.
func ensureTeamTestProject(t *testing.T, stmts service.AllStatements) (projectID string) {
	t.Helper()

	project := newTestProject(uniqueProjectID(t))
	require.NoError(t, stmts.CreateProject(t.Context(), project))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), project.ID) })
	return project.ID
}

func TestTeamStatements_Create(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("creates team and timestamps are set", func(t *testing.T) {
			projectID := ensureTeamTestProject(t, d.stmts)
			teamID := uniqueTeamID(t)

			team := newTestTeam(projectID, teamID)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			assert.Equal(t, domain.TeamStatusActive, team.Status)
			assert.False(t, team.CreatedAt.IsZero())
			assert.False(t, team.UpdatedAt.IsZero())
			assert.WithinDuration(t, time.Now(), team.CreatedAt, 5*time.Second)

			stored, err := d.stmts.GetTeamByID(t.Context(), projectID, teamID)
			require.NoError(t, err)
			assert.Equal(t, projectID, stored.ProjectID)
			assert.Equal(t, teamID, stored.ID)
			assert.Equal(t, team.Name, stored.Name)
			assert.Equal(t, domain.TeamStatusActive, stored.Status)
		})

		// Both dialects reject this in Go, before the statement is built.
		t.Run("empty id returns error", func(t *testing.T) {
			projectID := ensureTeamTestProject(t, d.stmts)

			assert.Error(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, "")))
		})

		t.Run("name violating the column check returns error", func(t *testing.T) {
			for _, tc := range []struct {
				name     string
				teamName string
			}{
				{"empty", ""},
				{"over the length limit", strings.Repeat("a", domain.TeamNameMaxLength+1)},
			} {
				t.Run(tc.name, func(t *testing.T) {
					projectID := ensureTeamTestProject(t, d.stmts)

					team := newTestTeam(projectID, uniqueTeamID(t))
					team.Name = tc.teamName
					assert.ErrorIs(t, d.stmts.CreateTeam(t.Context(), team), new(database.CheckError))
				})
			}
		})

		t.Run("duplicate (project_id, id) returns error", func(t *testing.T) {
			projectID := ensureTeamTestProject(t, d.stmts)
			teamID := uniqueTeamID(t)

			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))

			err := d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID))
			assert.ErrorIs(t, err, new(database.UniqueError))
		})

		t.Run("duplicate name in the same project returns error", func(t *testing.T) {
			for _, tc := range []struct {
				name    string
				nameFor func(string) string
			}{
				{"exact match", func(name string) string { return name }},
				{"differing only in case", strings.ToUpper},
			} {
				t.Run(tc.name, func(t *testing.T) {
					projectID := ensureTeamTestProject(t, d.stmts)
					teamID := uniqueTeamID(t)

					team := newTestTeam(projectID, teamID)
					require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

					duplicate := newTestTeam(projectID, teamID+"-2")
					duplicate.Name = tc.nameFor(team.Name)
					err := d.stmts.CreateTeam(t.Context(), duplicate)
					assert.ErrorIs(t, err, new(database.UniqueError))
				})
			}
		})

		t.Run("same name in different projects is allowed", func(t *testing.T) {
			projectID := ensureTeamTestProject(t, d.stmts)
			otherProjectID := ensureTeamTestProject(t, d.stmts)
			teamID := uniqueTeamID(t)

			team := newTestTeam(projectID, teamID)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

			other := newTestTeam(otherProjectID, teamID)
			other.Name = team.Name
			require.NoError(t, d.stmts.CreateTeam(t.Context(), other))
		})
	})
}

func TestTeamStatements_Get(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("returns team by project_id and id", func(t *testing.T) {
			projectID := ensureTeamTestProject(t, d.stmts)
			teamID := uniqueTeamID(t)
			team := newTestTeam(projectID, teamID)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

			stored, err := d.stmts.GetTeamByID(t.Context(), projectID, teamID)
			require.NoError(t, err)
			assert.Equal(t, projectID, stored.ProjectID)
			assert.Equal(t, teamID, stored.ID)
			assert.Equal(t, team.Name, stored.Name)
			assert.False(t, stored.CreatedAt.IsZero())
		})

		t.Run("not found returns NoRowFoundError", func(t *testing.T) {
			_, err := d.stmts.GetTeamByID(t.Context(), "proj-nonexistent", "team-nonexistent")
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})
	})
}

func TestTeamStatements_UpdateTeam(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("updates team", func(t *testing.T) {
			projectID := ensureTeamTestProject(t, d.stmts)
			teamID := uniqueTeamID(t)
			team := newTestTeam(projectID, teamID)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			createdAt, updatedAt := team.CreatedAt, team.UpdatedAt

			team.Name = "updated name"
			require.NoError(t, d.stmts.UpdateTeam(t.Context(), team))
			assert.Equal(t, "updated name", team.Name)
			assert.Equal(t, projectID, team.ProjectID)
			assert.Equal(t, teamID, team.ID)
			assert.Equal(t, domain.TeamStatusActive, team.Status)
			assert.Equal(t, createdAt, team.CreatedAt)
			assert.True(t, team.UpdatedAt.After(updatedAt))
		})

		t.Run("team not found returns NoRowFoundError", func(t *testing.T) {
			projectID := ensureTeamTestProject(t, d.stmts)
			team := newTestTeam(projectID, "nonexistent")
			assert.ErrorIs(t,
				d.stmts.UpdateTeam(t.Context(), team),
				new(database.NoRowFoundError),
			)
		})

		t.Run("deactivated team returns NoRowFoundError", func(t *testing.T) {
			projectID := ensureTeamTestProject(t, d.stmts)
			teamID := uniqueTeamID(t)
			team := newTestTeam(projectID, teamID)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			require.NoError(t, d.stmts.DeactivateTeam(t.Context(), projectID, teamID))

			team.Name = "updated name"
			assert.ErrorIs(t,
				d.stmts.UpdateTeam(t.Context(), team),
				new(database.NoRowFoundError),
			)
		})

		t.Run("name violates uniqueness constraint", func(t *testing.T) {
			projectID := ensureTeamTestProject(t, d.stmts)
			teamID := uniqueTeamID(t)
			team := newTestTeam(projectID, teamID)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

			taken := newTestTeam(projectID, teamID+"-taken")
			require.NoError(t, d.stmts.CreateTeam(t.Context(), taken))

			team.Name = taken.Name
			assert.ErrorIs(t,
				d.stmts.UpdateTeam(t.Context(), team),
				new(database.UniqueError),
			)

			// a case-only difference still collides.
			team.Name = strings.ToUpper(taken.Name)
			assert.ErrorIs(t,
				d.stmts.UpdateTeam(t.Context(), team),
				new(database.UniqueError),
			)
		})

		t.Run("unchanged name", func(t *testing.T) {
			projectID := ensureTeamTestProject(t, d.stmts)
			team := newTestTeam(projectID, uniqueTeamID(t))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			name := team.Name

			// The row already holds the name it is updated to, so the unique index
			// must not read it as a collision.
			require.NoError(t, d.stmts.UpdateTeam(t.Context(), team))
			assert.Equal(t, name, team.Name)
		})

		t.Run("same name in another project", func(t *testing.T) {
			projectID := ensureTeamTestProject(t, d.stmts)
			team := newTestTeam(projectID, uniqueTeamID(t))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

			otherProjectID := ensureTeamTestProject(t, d.stmts)
			other := newTestTeam(otherProjectID, uniqueTeamID(t))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), other))

			other.Name = team.Name
			require.NoError(t, d.stmts.UpdateTeam(t.Context(), other))
			assert.Equal(t, team.Name, other.Name)
		})
	})
}

func TestTeamStatements_Deactivate(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureTeamTestProject(t, d.stmts)
		teamID := uniqueTeamID(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))

		// DeactivateTeam opens its own withTransaction when called via pool.Statements().
		require.NoError(t, d.stmts.DeactivateTeam(t.Context(), projectID, teamID))

		stored, err := d.stmts.GetTeamByID(t.Context(), projectID, teamID)
		require.NoError(t, err)
		assert.Equal(t, domain.TeamStatusDeactivated, stored.Status)
	})
}
