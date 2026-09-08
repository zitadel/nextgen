//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// foreignTeamGrant is a platform-homed user with a team membership there, and
// optionally that team granted viewer on a customer project.
type foreignTeamGrant struct {
	customer, platform, userID, teamID string
}

func seedForeignTeamGrant(t *testing.T, stmts service.AllStatements, withCustomerAssignment bool) foreignTeamGrant {
	t.Helper()
	g := foreignTeamGrant{
		platform: ensureProject(t, stmts),
		customer: ensureProject(t, stmts),
		userID:   "user_home_" + uniqueSuffix(t),
		teamID:   "team_agency_" + uniqueSuffix(t),
	}
	require.NoError(t, stmts.CreateTeam(t.Context(), newTestTeam(g.platform, g.teamID)))
	require.NoError(t, stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(g.platform, g.teamID, g.userID)))
	if withCustomerAssignment {
		require.NoError(t, stmts.CreateAuthzAssignment(t.Context(),
			newTestAssignment(g.customer, "", domain.AuthzPrincipalTypeTeam, g.teamID, "project", "viewer", domain.NewProjectAssignmentScope())))
	}
	return g
}

func (g foreignTeamGrant) checkParams(objectType, relation string) domain.AuthzCheckParams {
	return domain.AuthzCheckParams{
		CatalogID:              domain.SystemCatalogID,
		ProjectID:              g.customer,
		PrincipalHomeProjectID: g.platform,
		PrincipalType:          domain.AuthzPrincipalTypeUser,
		PrincipalID:            g.userID,
		ObjectType:             objectType,
		Relation:               relation,
	}
}

func TestAuthzResolver_Home(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		check := func(t *testing.T, params domain.AuthzCheckParams) (bool, bool) {
			t.Helper()
			allowed, foothold, err := d.stmts.CheckAuthz(t.Context(), params)
			require.NoError(t, err)
			return allowed, foothold
		}
		listUsers := func(t *testing.T, params domain.AuthzCheckParams) []string {
			t.Helper()
			ids, err := d.stmts.ListAuthzObjectIDs(t.Context(), domain.AuthzListObjectsParams{
				AuthzCheckParams: params,
				ResourceKind:     domain.ResourceKindUser,
			})
			require.NoError(t, err)
			return ids
		}

		t.Run("home project id defaults to project", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			u := "user_home_def_" + uniqueSuffix(t)
			team := "team_home_def_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, team)))
			require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(projectID, team, u)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, team, "project", "viewer", domain.NewProjectAssignmentScope())))
			params := domain.AuthzCheckParams{
				CatalogID:     domain.SystemCatalogID,
				ProjectID:     projectID,
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   u,
				ObjectType:    "project",
				Relation:      "viewer",
			}
			allowed, _ := check(t, params)
			assert.True(t, allowed)
		})

		t.Run("home project mismatch deny expand", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			u := "user_home_mis_" + uniqueSuffix(t)
			team := "team_home_mis_" + uniqueSuffix(t)
			other := ensureProject(t, d.stmts)
			otherTeam := "team_home_other_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, team)))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(other, otherTeam)))
			// Membership only in other project; grant team viewer in protected project.
			require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(other, otherTeam, u)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, team, "project", "viewer", domain.NewProjectAssignmentScope())))
			allowed, _ := check(t, domain.AuthzCheckParams{
				CatalogID:     domain.SystemCatalogID,
				ProjectID:     projectID,
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   u,
				ObjectType:    "project",
				Relation:      "viewer",
			})
			assert.False(t, allowed)
		})

		t.Run("foreign team grant homes", func(t *testing.T) {
			g := seedForeignTeamGrant(t, d.stmts, true)
			res := "usr_listed_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(g.customer, res)))

			for _, tc := range []struct {
				name       string
				home       string
				wantAllow  bool
				wantFoot   bool
				wantListed bool
			}{
				{"platform home", g.platform, true, true, true},
				{"empty home", "", false, false, false},             // defaults to target
				{"target as home", g.customer, false, false, false}, // same path, different spelling
			} {
				t.Run(tc.name, func(t *testing.T) {
					params := g.checkParams("project", "viewer")
					params.PrincipalHomeProjectID = tc.home
					allowed, foothold := check(t, params)
					assert.Equal(t, tc.wantAllow, allowed)
					assert.Equal(t, tc.wantFoot, foothold)
					ok, err := d.stmts.HasAuthzProjectFoothold(t.Context(), g.customer, tc.home, domain.AuthzPrincipalTypeUser, g.userID)
					require.NoError(t, err)
					assert.Equal(t, tc.wantFoot, ok)
					ids := listUsers(t, params)
					if tc.wantListed {
						assert.Contains(t, ids, res)
					} else {
						assert.NotContains(t, ids, res)
					}
				})
			}
		})

		t.Run("foreign team grant foothold without allow", func(t *testing.T) {
			g := seedForeignTeamGrant(t, d.stmts, true)
			allowed, foothold := check(t, g.checkParams("team", "member"))
			assert.False(t, allowed)
			assert.True(t, foothold)
		})

		t.Run("home membership without assignment is not foothold", func(t *testing.T) {
			g := seedForeignTeamGrant(t, d.stmts, false)
			allowed, foothold := check(t, g.checkParams("project", "viewer"))
			assert.False(t, allowed)
			assert.False(t, foothold)
			ok, err := d.stmts.HasAuthzProjectFoothold(t.Context(), g.customer, g.platform, domain.AuthzPrincipalTypeUser, g.userID)
			require.NoError(t, err)
			assert.False(t, ok)
		})

		t.Run("local membership shortcut ignores distinct home", func(t *testing.T) {
			customer := ensureProject(t, d.stmts)
			platform := ensureProject(t, d.stmts)
			userID := "user_local_" + uniqueSuffix(t)
			localTeam := "team_local_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(customer, localTeam)))
			require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(customer, localTeam, userID)))
			allowed, foothold := check(t, domain.AuthzCheckParams{
				CatalogID:              domain.SystemCatalogID,
				ProjectID:              customer,
				PrincipalHomeProjectID: platform,
				PrincipalType:          domain.AuthzPrincipalTypeUser,
				PrincipalID:            userID,
				ObjectType:             "project",
				Relation:               "viewer",
			})
			assert.False(t, allowed)
			assert.True(t, foothold)
			ok, err := d.stmts.HasAuthzProjectFoothold(t.Context(), customer, platform, domain.AuthzPrincipalTypeUser, userID)
			require.NoError(t, err)
			assert.True(t, ok)
		})
	})
}
