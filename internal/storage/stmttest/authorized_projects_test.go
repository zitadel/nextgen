//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/authz/compiler"
	"github.com/zitadel/nextgen/internal/authz/openfga"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// authorizedProjectsOrderAsc is the only ordering the discovery query serves.
var authorizedProjectsOrderAsc = database.OrderBy[domain.ProjectField]{
	Columns:   []database.Column[domain.ProjectField]{database.Col(domain.ProjectFieldID)},
	Direction: database.OrderAsc,
}

// authorizedUser is a user homed in a platform project, member of one team there.
type authorizedUser struct {
	platform, userID, teamID string
}

func seedAuthorizedUser(t *testing.T, stmts service.AllStatements) authorizedUser {
	t.Helper()
	u := authorizedUser{
		platform: ensureProject(t, stmts),
		userID:   "user_disc_" + uniqueSuffix(t),
		teamID:   "team_disc_" + uniqueSuffix(t),
	}
	require.NoError(t, stmts.CreateTeam(t.Context(), newTestTeam(u.platform, u.teamID)))
	require.NoError(t, stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(u.platform, u.teamID, u.userID)))
	return u
}

func listAuthorizedProjectIDs(t *testing.T, stmts service.AllStatements, u authorizedUser) []string {
	t.Helper()
	result, err := stmts.ListAuthorizedProjects(t.Context(), u.platform, u.userID, database.Page[domain.ProjectField]{
		Limit:   100,
		OrderBy: authorizedProjectsOrderAsc,
	})
	require.NoError(t, err)
	require.NotNil(t, result)
	return projectIDs(result.Items)
}

func TestListAuthorizedProjects(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("owning team grant", func(t *testing.T) {
			u := seedAuthorizedUser(t, d.stmts)
			customer := ensureProject(t, d.stmts)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), domain.NewClaimTeamAssignment(customer, u.teamID)))
			assert.Equal(t, []string{customer}, listAuthorizedProjectIDs(t, d.stmts, u))
		})

		t.Run("direct user grant", func(t *testing.T) {
			u := seedAuthorizedUser(t, d.stmts)
			customer := ensureProject(t, d.stmts)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(customer, "", domain.AuthzPrincipalTypeUser, u.userID, "project", "viewer", domain.NewProjectAssignmentScope())))
			assert.Equal(t, []string{customer}, listAuthorizedProjectIDs(t, d.stmts, u))
		})

		t.Run("direct and team grant on the same project yield one row", func(t *testing.T) {
			u := seedAuthorizedUser(t, d.stmts)
			customer := ensureProject(t, d.stmts)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), domain.NewClaimTeamAssignment(customer, u.teamID)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(customer, "", domain.AuthzPrincipalTypeUser, u.userID, "project", "viewer", domain.NewProjectAssignmentScope())))
			assert.Equal(t, []string{customer}, listAuthorizedProjectIDs(t, d.stmts, u))
		})

		t.Run("no grants", func(t *testing.T) {
			u := seedAuthorizedUser(t, d.stmts)
			ensureProject(t, d.stmts)
			assert.Empty(t, listAuthorizedProjectIDs(t, d.stmts, u))
		})

		t.Run("revoked grant", func(t *testing.T) {
			u := seedAuthorizedUser(t, d.stmts)
			customer := ensureProject(t, d.stmts)
			a := domain.NewClaimTeamAssignment(customer, u.teamID)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), a))
			require.NoError(t, d.stmts.RevokeAuthzAssignment(t.Context(), customer, a.ID))
			assert.Empty(t, listAuthorizedProjectIDs(t, d.stmts, u))
		})

		t.Run("expired grant", func(t *testing.T) {
			u := seedAuthorizedUser(t, d.stmts)
			customer := ensureProject(t, d.stmts)
			expired := time.Now().Add(-time.Hour)
			a := newTestAssignment(customer, "", domain.AuthzPrincipalTypeUser, u.userID, "project", "viewer", domain.NewProjectAssignmentScope())
			a.ExpiresAt = &expired
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), a))
			assert.Empty(t, listAuthorizedProjectIDs(t, d.stmts, u))
		})

		t.Run("deactivated team drops the edge", func(t *testing.T) {
			u := seedAuthorizedUser(t, d.stmts)
			customer := ensureProject(t, d.stmts)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), domain.NewClaimTeamAssignment(customer, u.teamID)))
			require.Equal(t, []string{customer}, listAuthorizedProjectIDs(t, d.stmts, u))
			changed, err := d.stmts.DeactivateTeam(t.Context(), u.platform, u.teamID)
			require.NoError(t, err)
			require.True(t, changed)
			assert.Empty(t, listAuthorizedProjectIDs(t, d.stmts, u))
		})

		t.Run("team scoped grant is not project level", func(t *testing.T) {
			u := seedAuthorizedUser(t, d.stmts)
			customer := ensureProject(t, d.stmts)
			scopeTeam := "team_scope_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(customer, scopeTeam)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(customer, "", domain.AuthzPrincipalTypeUser, u.userID, "project", "viewer", domain.NewTeamAssignmentScope(scopeTeam))))
			assert.Empty(t, listAuthorizedProjectIDs(t, d.stmts, u))
		})

		// The edge sits in the project being listed, which is the one place a
		// lookup keyed to the wrong project would find it. The user's home
		// project holds no edge for this team, so the list must stay empty.
		t.Run("edge in the listed project does not carry the grant", func(t *testing.T) {
			u := seedAuthorizedUser(t, d.stmts)
			customer := ensureProject(t, d.stmts)
			customerTeam := "team_customer_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(customer, customerTeam)))
			require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(customer, customerTeam, u.userID)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), domain.NewClaimTeamAssignment(customer, customerTeam)))
			assert.Empty(t, listAuthorizedProjectIDs(t, d.stmts, u))
		})

		// CheckAuthz only ever evaluates the active system catalog, so a grant
		// on any other catalog must not make a project discoverable.
		t.Run("app-group catalog assignment is ignored", func(t *testing.T) {
			u := seedAuthorizedUser(t, d.stmts)
			customer := ensureProject(t, d.stmts)

			model, err := openfga.ParseDSL(sampleCatalogOpenFGAModel)
			require.NoError(t, err)
			output, err := compiler.Compile(model)
			require.NoError(t, err)
			appCatalogID := "cat_app_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.PersistCatalogVersion(t.Context(), domain.AuthzCatalogVersion{
				ID: appCatalogID, CatalogKind: domain.AuthzCatalogKindAppGroup, OwnerID: "owner_" + uniqueSuffix(t), Version: 1,
			}, output.Catalog))

			appGrant := &domain.AuthzAssignment{
				ProjectID: customer, CatalogID: appCatalogID,
				PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: u.userID,
				ObjectType: "project", Relation: "viewer",
			}
			appGrant.ApplyScope(domain.NewProjectAssignmentScope())
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), appGrant))

			assert.Empty(t, listAuthorizedProjectIDs(t, d.stmts, u))
		})

		// The third arm of ADR 053 §6: nothing joins the user to the owning team,
		// so only the tuple-to-userset path authorizes these. The fixtures mirror
		// the resolver's "check ttu general …" cases one for one.
		t.Run("tuple to userset", func(t *testing.T) {
			// seedTTU gives the project an owning-team grant held by a fresh team
			// and returns both ids. The user gets no edge into that team.
			seedTTU := func(t *testing.T, u authorizedUser) (customer, team string) {
				t.Helper()
				customer = ensureProject(t, d.stmts)
				team = "team_ttu_" + uniqueSuffix(t)
				require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(customer, team)))
				require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
					newTestAssignment(customer, "", domain.AuthzPrincipalTypeTeam, team, "project", "team", domain.NewProjectAssignmentScope())))
				return customer, team
			}

			t.Run("user held team member with team scope", func(t *testing.T) {
				u := seedAuthorizedUser(t, d.stmts)
				customer, team := seedTTU(t, u)
				require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
					newTestAssignment(customer, "", domain.AuthzPrincipalTypeUser, u.userID, "team", "member", domain.NewTeamAssignmentScope(team))))
				assert.Equal(t, []string{customer}, listAuthorizedProjectIDs(t, d.stmts, u))
			})

			t.Run("user held team member with resource scope", func(t *testing.T) {
				u := seedAuthorizedUser(t, d.stmts)
				customer, team := seedTTU(t, u)
				require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
					newTestAssignment(customer, "", domain.AuthzPrincipalTypeUser, u.userID, "team", "member", domain.NewResourceAssignmentScope(team))))
				assert.Equal(t, []string{customer}, listAuthorizedProjectIDs(t, d.stmts, u))
			})

			t.Run("user held team member with project scope", func(t *testing.T) {
				u := seedAuthorizedUser(t, d.stmts)
				customer, _ := seedTTU(t, u)
				require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
					newTestAssignment(customer, "", domain.AuthzPrincipalTypeUser, u.userID, "team", "member", domain.NewProjectAssignmentScope())))
				assert.Equal(t, []string{customer}, listAuthorizedProjectIDs(t, d.stmts, u))
			})

			// The user-side assignment may itself be team held, expanded through a
			// membership edge in the home project, exactly as the resolver allows.
			t.Run("team held team member reaches through the home edge", func(t *testing.T) {
				u := seedAuthorizedUser(t, d.stmts)
				customer, team := seedTTU(t, u)
				require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
					newTestAssignment(customer, "", domain.AuthzPrincipalTypeTeam, u.teamID, "team", "member", domain.NewTeamAssignmentScope(team))))
				assert.Equal(t, []string{customer}, listAuthorizedProjectIDs(t, d.stmts, u))
			})

			t.Run("wrong team scope is absent", func(t *testing.T) {
				u := seedAuthorizedUser(t, d.stmts)
				customer, _ := seedTTU(t, u)
				other := "team_ttu_other_" + uniqueSuffix(t)
				require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(customer, other)))
				require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
					newTestAssignment(customer, "", domain.AuthzPrincipalTypeUser, u.userID, "team", "member", domain.NewTeamAssignmentScope(other))))
				assert.Empty(t, listAuthorizedProjectIDs(t, d.stmts, u))
			})

			t.Run("revoked team member row is absent", func(t *testing.T) {
				u := seedAuthorizedUser(t, d.stmts)
				customer, team := seedTTU(t, u)
				a := newTestAssignment(customer, "", domain.AuthzPrincipalTypeUser, u.userID, "team", "member", domain.NewTeamAssignmentScope(team))
				require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), a))
				require.Equal(t, []string{customer}, listAuthorizedProjectIDs(t, d.stmts, u))

				require.NoError(t, d.stmts.RevokeAuthzAssignment(t.Context(), customer, a.ID))
				assert.Empty(t, listAuthorizedProjectIDs(t, d.stmts, u))
			})
		})

		t.Run("paging", func(t *testing.T) {
			u := seedAuthorizedUser(t, d.stmts)
			want := make([]string, 0, 3)
			for range 3 {
				customer := ensureProject(t, d.stmts)
				require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), domain.NewClaimTeamAssignment(customer, u.teamID)))
				want = append(want, customer)
			}
			slices.Sort(want)

			first, err := d.stmts.ListAuthorizedProjects(t.Context(), u.platform, u.userID, database.Page[domain.ProjectField]{
				Limit: 2, OrderBy: authorizedProjectsOrderAsc,
			})
			require.NoError(t, err)
			assert.Equal(t, want[:2], projectIDs(first.Items))
			require.NotEmpty(t, first.NextCursor)

			second, err := d.stmts.ListAuthorizedProjects(t.Context(), u.platform, u.userID, database.Page[domain.ProjectField]{
				Limit: 2, OrderBy: authorizedProjectsOrderAsc, Cursor: first.NextCursor,
			})
			require.NoError(t, err)
			assert.Equal(t, want[2:], projectIDs(second.Items))
			assert.Empty(t, second.NextCursor)

			_, err = d.stmts.ListAuthorizedProjects(t.Context(), u.platform, u.userID, database.Page[domain.ProjectField]{
				Limit: 2,
				OrderBy: database.OrderBy[domain.ProjectField]{
					Columns:   []database.Column[domain.ProjectField]{database.Col(domain.ProjectFieldName)},
					Direction: database.OrderAsc,
				},
				Cursor: first.NextCursor,
			})
			assertDatabaseErrorCode(t, err, "db.cursor_order_mismatch")
		})
	})
}
