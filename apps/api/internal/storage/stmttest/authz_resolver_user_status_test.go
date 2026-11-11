//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// TestAuthzResolver_UserStatus pins ADR 053 §4 for every user principal,
// foreign and local: a grant counts only while its user is active in their home
// project (#1234). Deactivation removes the user's membership edges, which
// closes the team paths, but leaves direct assignments in place, and the
// sessions minted for the user survive it (#553). So the resolver reads the
// status itself, on Check, on the materialized list and on the EXISTS list
// predicate alike.
func TestAuthzResolver_UserStatus(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		customer, customerSchema := ensureUserTestProject(t, d.stmts)
		platform, platformSchema := ensureUserTestProject(t, d.stmts)
		catalogID, err := d.stmts.ActiveSystemCatalogID(t.Context())
		require.NoError(t, err)

		newUser := func(t *testing.T, projectID, schemaURL, prefix string, team *string) string {
			t.Helper()
			id := prefix + uniqueSuffix(t)
			user := newTestUser(t, projectID, schemaURL, id, id+"@example.com", prefix)
			user.InitialMembershipTeamID = team
			require.NoError(t, d.stmts.CreateUser(t.Context(), user))
			return id
		}
		// A customer user for the lists to find and a by-id Check to target.
		target := newUser(t, customer, customerSchema, "usr-target-", nil)

		// access asks every read path that decides who may see what, and
		// requires each of them to answer want.
		access := func(t *testing.T, params domain.AuthzCheckParams, want bool) {
			t.Helper()
			allowed, foothold, err := d.stmts.CheckAuthz(t.Context(), params)
			require.NoError(t, err)
			assert.Equal(t, want, allowed, "Check allows")
			assert.Equal(t, want, foothold, "Check foothold: a refused user answers like an unknown one")

			// By id, on another user and on the principal's own record.
			for _, id := range []string{target, params.PrincipalID} {
				byID := params
				byID.ResourceID = id
				allowed, foothold, err := d.stmts.CheckAuthz(t.Context(), byID)
				require.NoError(t, err)
				assert.Equal(t, want, allowed, "by-id Check of %s allows", id)
				assert.Equal(t, want, foothold, "by-id Check of %s foothold", id)
			}

			ok, err := d.stmts.HasAuthzProjectFoothold(t.Context(), params.ProjectID, params.PrincipalHomeProjectID, params.PrincipalType, params.PrincipalID)
			require.NoError(t, err)
			assert.Equal(t, want, ok, "HasAuthzProjectFoothold")

			list := domain.AuthzListObjectsParams{AuthzCheckParams: params, ResourceKind: domain.ResourceKindUser}
			ids, err := d.stmts.ListAuthzObjectIDs(t.Context(), list)
			require.NoError(t, err)
			if want {
				assert.Contains(t, ids, target, "ListAuthzObjectIDs")
			} else {
				assert.Empty(t, ids, "ListAuthzObjectIDs")
			}

			// The EXISTS predicate every HTTP management list runs.
			res, err := d.stmts.ListUsers(service.WithAuthzListFilter(t.Context(), list),
				&database.ListOptions[domain.UserField]{
					Filter: database.Equal(database.Col(domain.UserFieldProjectID), params.ProjectID),
				}, service.UserQueryOptions{})
			require.NoError(t, err)
			if want {
				assert.Contains(t, userIDs(res.Items), target, "list predicate")
			} else {
				assert.Empty(t, res.Items, "list predicate")
			}
		}

		for _, home := range []struct {
			name, projectID, schemaURL string
		}{
			{"local user", customer, customerSchema},
			{"foreign user", platform, platformSchema},
		} {
			params := func(userID, relation string) domain.AuthzCheckParams {
				return domain.AuthzCheckParams{
					CatalogID:              catalogID,
					ProjectID:              customer,
					PrincipalHomeProjectID: home.projectID,
					PrincipalType:          domain.AuthzPrincipalTypeUser,
					PrincipalID:            userID,
					ObjectType:             "project",
					Relation:               relation,
				}
			}

			t.Run(home.name+" with a direct grant", func(t *testing.T) {
				userID := newUser(t, home.projectID, home.schemaURL, "usr-direct-", nil)
				require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
					newTestAssignment(customer, "", domain.AuthzPrincipalTypeUser, userID, "project", "admin", domain.NewProjectAssignmentScope())))

				t.Run("allows while the user is active", func(t *testing.T) {
					access(t, params(userID, "admin"), true)
				})

				require.NoError(t, d.stmts.DeactivateUser(t.Context(), home.projectID, userID))
				t.Run("counts for nothing once the user is deactivated in their home project", func(t *testing.T) {
					access(t, params(userID, "admin"), false)
				})

				require.NoError(t, d.reactivateUser(t.Context(), home.projectID, userID))
				t.Run("allows again after reactivation", func(t *testing.T) {
					access(t, params(userID, "admin"), true)
				})
			})

			t.Run(home.name+" through a team grant", func(t *testing.T) {
				teamID := "team-status-" + uniqueSuffix(t)
				require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(home.projectID, teamID)))
				require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
					newTestAssignment(customer, "", domain.AuthzPrincipalTypeTeam, teamID, "project", "viewer", domain.NewProjectAssignmentScope())))
				member := newUser(t, home.projectID, home.schemaURL, "usr-member-", &teamID)
				bystander := newUser(t, home.projectID, home.schemaURL, "usr-bystander-", &teamID)

				t.Run("allows an active member", func(t *testing.T) {
					access(t, params(member, "viewer"), true)
				})

				require.NoError(t, d.stmts.DeactivateUser(t.Context(), home.projectID, bystander))
				t.Run("another member's deactivation leaves it alone", func(t *testing.T) {
					access(t, params(member, "viewer"), true)
				})

				require.NoError(t, d.stmts.DeactivateUser(t.Context(), home.projectID, member))
				t.Run("closes once the member is deactivated", func(t *testing.T) {
					access(t, params(member, "viewer"), false)
				})
			})
		}

		t.Run("a user with no row in their home project holds nothing", func(t *testing.T) {
			// An identifier is not proof the principal exists (ADR 053 §3).
			ghost := "usr-ghost-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(customer, "", domain.AuthzPrincipalTypeUser, ghost, "project", "admin", domain.NewProjectAssignmentScope())))
			allowed, foothold, err := d.stmts.CheckAuthz(t.Context(), domain.AuthzCheckParams{
				CatalogID: catalogID, ProjectID: customer, PrincipalHomeProjectID: platform,
				PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: ghost,
				ObjectType: "project", Relation: "admin",
			})
			require.NoError(t, err)
			assert.False(t, allowed)
			assert.False(t, foothold)
		})

		t.Run("a project secret has no user status to read", func(t *testing.T) {
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(customer, "", domain.AuthzPrincipalTypeSKProj, customer, "project", "admin", domain.NewProjectAssignmentScope())))
			allowed, _, err := d.stmts.CheckAuthz(t.Context(), domain.AuthzCheckParams{
				CatalogID: catalogID, ProjectID: customer, PrincipalHomeProjectID: customer,
				PrincipalType: domain.AuthzPrincipalTypeSKProj, PrincipalID: customer,
				ObjectType: "project", Relation: "admin",
			})
			require.NoError(t, err)
			assert.True(t, allowed)
		})
	})
}
