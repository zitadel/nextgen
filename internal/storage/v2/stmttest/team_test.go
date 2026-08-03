//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
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
