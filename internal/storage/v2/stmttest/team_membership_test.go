//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestTeamMembershipStatements_Get(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("returns_created_membership", func(t *testing.T) {
			projectID, schemaURL := ensureUserTestProject(t, d.stmts)
			teamID := "team-tm-" + uniqueSuffix(t)
			userID := "usr-tm-" + uniqueSuffix(t)

			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Member")))

			membership := &domain.TeamMembership{
				ProjectID: projectID,
				TeamID:    teamID,
				UserID:    userID,
				Status:    domain.MembershipStatusActive,
			}
			require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), membership))
			assert.False(t, membership.CreatedAt.IsZero())
			assert.False(t, membership.UpdatedAt.IsZero())

			got, err := d.stmts.GetTeamMembership(t.Context(), projectID, teamID, userID)
			require.NoError(t, err)
			assert.Equal(t, projectID, got.ProjectID)
			assert.Equal(t, teamID, got.TeamID)
			assert.Equal(t, userID, got.UserID)
			assert.Equal(t, domain.MembershipStatusActive, got.Status)
		})

		t.Run("missing_returns_NoRowFoundError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			_, err := d.stmts.GetTeamMembership(t.Context(), projectID, "missing-team", "missing-user")
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})

		t.Run("missing_user_returns_ForeignKeyError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			teamID := "team-tm-fk-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))

			err := d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
				ProjectID: projectID,
				TeamID:    teamID,
				UserID:    "missing-user-" + uniqueSuffix(t),
				Status:    domain.MembershipStatusActive,
			})
			assert.ErrorIs(t, err, new(database.ForeignKeyError))
		})
	})
}
