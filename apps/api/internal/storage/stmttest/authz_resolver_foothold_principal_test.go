//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// TestAuthzResolver_FootholdPrincipalMatch covers foothold arms that are not
// the foreign-team expand happy path: a direct user or team principal still
// matches when home ≠ project, a revoked team grant does not, and Arm 2 stays
// user-only.
func TestAuthzResolver_FootholdPrincipalMatch(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("direct user assignment ignores distinct home", func(t *testing.T) {
			customer := ensureProject(t, d.stmts)
			platform := ensureProject(t, d.stmts)
			u := "user_direct_home_" + uniqueSuffix(t)
			res := "usr_listed_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(customer, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())))
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(customer, res)))

			params := domain.AuthzCheckParams{
				CatalogID:              domain.SystemCatalogID,
				ProjectID:              customer,
				PrincipalHomeProjectID: platform,
				PrincipalType:          domain.AuthzPrincipalTypeUser,
				PrincipalID:            u,
				ObjectType:             "project",
				Relation:               "viewer",
			}
			allowed, foothold, err := d.stmts.CheckAuthz(t.Context(), params)
			require.NoError(t, err)
			assert.True(t, allowed)
			assert.True(t, foothold)
			ok, err := d.stmts.HasAuthzProjectFoothold(t.Context(), customer, platform, domain.AuthzPrincipalTypeUser, u)
			require.NoError(t, err)
			assert.True(t, ok)
			ids, err := d.stmts.ListAuthzObjectIDs(t.Context(), domain.AuthzListObjectsParams{
				AuthzCheckParams: params,
				ResourceKind:     domain.ResourceKindUser,
			})
			require.NoError(t, err)
			assert.Contains(t, ids, res)
		})

		t.Run("team principal assignment ignores distinct home", func(t *testing.T) {
			customer := ensureProject(t, d.stmts)
			platform := ensureProject(t, d.stmts)
			teamID := "team_prin_home_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(customer, teamID)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(customer, "", domain.AuthzPrincipalTypeTeam, teamID, "project", "viewer", domain.NewProjectAssignmentScope())))

			allowed, foothold, err := d.stmts.CheckAuthz(t.Context(), domain.AuthzCheckParams{
				CatalogID:              domain.SystemCatalogID,
				ProjectID:              customer,
				PrincipalHomeProjectID: platform,
				PrincipalType:          domain.AuthzPrincipalTypeTeam,
				PrincipalID:            teamID,
				ObjectType:             "project",
				Relation:               "viewer",
			})
			require.NoError(t, err)
			assert.True(t, allowed)
			assert.True(t, foothold)
			ok, err := d.stmts.HasAuthzProjectFoothold(t.Context(), customer, platform, domain.AuthzPrincipalTypeTeam, teamID)
			require.NoError(t, err)
			assert.True(t, ok)
		})

		t.Run("revoked foreign team grant is not foothold", func(t *testing.T) {
			g := seedForeignTeamGrant(t, d.stmts, true)
			asgns, err := d.stmts.ListAuthzAssignments(t.Context(), g.customer, domain.AuthzPrincipalTypeTeam, g.teamID, true)
			require.NoError(t, err)
			require.NotEmpty(t, asgns)
			require.NoError(t, d.stmts.RevokeAuthzAssignment(t.Context(), g.customer, asgns[0].ID))

			allowed, foothold, err := d.stmts.CheckAuthz(t.Context(), g.checkParams("project", "viewer"))
			require.NoError(t, err)
			assert.False(t, allowed)
			assert.False(t, foothold)
			ok, err := d.stmts.HasAuthzProjectFoothold(t.Context(), g.customer, g.platform, domain.AuthzPrincipalTypeUser, g.userID)
			require.NoError(t, err)
			assert.False(t, ok)
		})

		t.Run("non-user principal skips local membership shortcut", func(t *testing.T) {
			customer := ensureProject(t, d.stmts)
			platform := ensureProject(t, d.stmts)
			localTeam := "team_arm2_" + uniqueSuffix(t)
			memberID := "user_arm2_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(customer, localTeam)))
			require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(customer, localTeam, memberID)))

			okUser, err := d.stmts.HasAuthzProjectFoothold(t.Context(), customer, platform, domain.AuthzPrincipalTypeUser, memberID)
			require.NoError(t, err)
			assert.True(t, okUser)
			okTeam, err := d.stmts.HasAuthzProjectFoothold(t.Context(), customer, platform, domain.AuthzPrincipalTypeTeam, memberID)
			require.NoError(t, err)
			assert.False(t, okTeam)
			okSK, err := d.stmts.HasAuthzProjectFoothold(t.Context(), customer, platform, domain.AuthzPrincipalTypeSKProj, memberID)
			require.NoError(t, err)
			assert.False(t, okSK)
		})
	})
}
