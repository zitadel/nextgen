//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"sort"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// createOwningTeamGrant seeds a project.team tupleset grant and revokes it on
// subtest cleanup: these cases share one project fixture, and
// authz_assignments_one_owning_team allows only one active owning-team row
// per project (ADR 054 §2), so each subtest must free the slot it takes.
func createOwningTeamGrant(t *testing.T, stmts service.AllStatements, a *domain.AuthzAssignment) {
	t.Helper()
	require.NoError(t, stmts.CreateAuthzAssignment(t.Context(), a))
	t.Cleanup(func() {
		// t.Context() is already canceled during cleanup; a re-revoke of an
		// explicitly revoked grant is a harmless NoRowFoundError.
		_ = stmts.RevokeAuthzAssignment(context.Background(), a.ProjectID, a.ID)
	})
}

func TestAuthzResolverStatements_Cases(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		teamT := "team_t_" + uniqueSuffix(t)
		teamU := "team_u_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamT)))
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamU)))

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
		base := func(principalType domain.AuthzPrincipalType, principalID, objectType, relation string) domain.AuthzCheckParams {
			return domain.AuthzCheckParams{
				CatalogID:     domain.SystemCatalogID,
				ProjectID:     projectID,
				PrincipalType: principalType,
				PrincipalID:   principalID,
				ObjectType:    objectType,
				Relation:      relation,
			}
		}

		// --- A. Catalog + foothold ---
		t.Run("active system catalog", func(t *testing.T) {
			id, err := d.stmts.ActiveSystemCatalogID(t.Context())
			require.NoError(t, err)
			assert.Equal(t, domain.SystemCatalogID, id)
		})

		t.Run("foothold none", func(t *testing.T) {
			ok, err := d.stmts.HasAuthzProjectFoothold(t.Context(), projectID, domain.AuthzPrincipalTypeUser, "user_none_"+uniqueSuffix(t))
			require.NoError(t, err)
			assert.False(t, ok)
		})

		t.Run("foothold via assignment", func(t *testing.T) {
			u := "user_fh_asgn_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())))
			ok, err := d.stmts.HasAuthzProjectFoothold(t.Context(), projectID, domain.AuthzPrincipalTypeUser, u)
			require.NoError(t, err)
			assert.True(t, ok)
		})

		t.Run("foothold via membership edge only", func(t *testing.T) {
			u := "user_fh_edge_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(projectID, teamT, u)))
			ok, err := d.stmts.HasAuthzProjectFoothold(t.Context(), projectID, domain.AuthzPrincipalTypeUser, u)
			require.NoError(t, err)
			assert.True(t, ok)
		})

		t.Run("foothold cleared after revoke", func(t *testing.T) {
			u := "user_fh_rev_" + uniqueSuffix(t)
			a := newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), a))
			require.NoError(t, d.stmts.RevokeAuthzAssignment(t.Context(), projectID, a.ID))
			ok, err := d.stmts.HasAuthzProjectFoothold(t.Context(), projectID, domain.AuthzPrincipalTypeUser, u)
			require.NoError(t, err)
			assert.False(t, ok)
		})

		t.Run("check foothold column allow", func(t *testing.T) {
			u := "user_col_allow_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())))
			allowed, foothold := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.True(t, allowed)
			assert.True(t, foothold)
		})

		t.Run("check foothold column forbidden", func(t *testing.T) {
			u := "user_col_forb_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())))
			allowed, foothold := check(t, base(domain.AuthzPrincipalTypeUser, u, "team", "member"))
			assert.False(t, allowed)
			assert.True(t, foothold)
		})

		t.Run("check foothold column not found", func(t *testing.T) {
			allowed, foothold := check(t, base(domain.AuthzPrincipalTypeUser, "user_missing_"+uniqueSuffix(t), "project", "viewer"))
			assert.False(t, allowed)
			assert.False(t, foothold)
		})

		// --- B. Check — project-scoped closure + principal expand ---
		t.Run("check direct project scope allow", func(t *testing.T) {
			u := "user_direct_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.True(t, allowed)
		})

		t.Run("check closure viewer implies editor", func(t *testing.T) {
			u := "user_impl_ed_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "editor"))
			assert.True(t, allowed)
		})

		t.Run("check closure viewer implies admin", func(t *testing.T) {
			u := "user_impl_ad_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "admin"))
			assert.True(t, allowed)
		})

		t.Run("check closure admin does not imply viewer", func(t *testing.T) {
			u := "user_admin_only_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "admin", domain.NewProjectAssignmentScope())))
			allowed, foothold := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.False(t, allowed)
			assert.True(t, foothold)
		})

		t.Run("check wrong relation deny", func(t *testing.T) {
			u := "user_wrong_rel_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())))
			allowed, foothold := check(t, base(domain.AuthzPrincipalTypeUser, u, "team", "member"))
			assert.False(t, allowed)
			assert.True(t, foothold)
		})

		t.Run("check revoked deny", func(t *testing.T) {
			u := "user_revoked_" + uniqueSuffix(t)
			a := newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), a))
			require.NoError(t, d.stmts.RevokeAuthzAssignment(t.Context(), projectID, a.ID))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.False(t, allowed)
		})

		t.Run("check expired deny", func(t *testing.T) {
			u := "user_expired_" + uniqueSuffix(t)
			a := newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())
			past := time.Now().Add(-time.Hour)
			a.ExpiresAt = &past
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), a))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.False(t, allowed)
		})

		t.Run("check future expiry allow", func(t *testing.T) {
			u := "user_future_" + uniqueSuffix(t)
			a := newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())
			future := time.Now().Add(time.Hour)
			a.ExpiresAt = &future
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), a))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.True(t, allowed)
		})

		t.Run("check null expiry allow", func(t *testing.T) {
			u := "user_null_exp_" + uniqueSuffix(t)
			a := newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())
			require.Nil(t, a.ExpiresAt)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), a))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.True(t, allowed)
		})

		t.Run("check team grant via membership", func(t *testing.T) {
			u := "user_team_mem_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(projectID, teamT, u)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, teamT, "project", "viewer", domain.NewProjectAssignmentScope())))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.True(t, allowed)
		})

		t.Run("check team grant without membership deny", func(t *testing.T) {
			u := "user_no_mem_" + uniqueSuffix(t)
			localTeam := "team_nomem_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, localTeam)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, localTeam, "project", "viewer", domain.NewProjectAssignmentScope())))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.False(t, allowed)
		})

		t.Run("check team principal direct", func(t *testing.T) {
			localTeam := "team_prin_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, localTeam)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, localTeam, "project", "viewer", domain.NewProjectAssignmentScope())))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeTeam, localTeam, "project", "viewer"))
			assert.True(t, allowed)
		})

		t.Run("check user principal does not match team id", func(t *testing.T) {
			localTeam := "team_notuser_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, localTeam)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, localTeam, "project", "viewer", domain.NewProjectAssignmentScope())))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, localTeam, "project", "viewer"))
			assert.False(t, allowed)
		})

		t.Run("check team scoped grant does not allow check", func(t *testing.T) {
			u := "user_team_scope_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewTeamAssignmentScope(teamT))))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.False(t, allowed, "no object ids → still deny")
			withTeam := base(domain.AuthzPrincipalTypeUser, u, "project", "viewer")
			withTeam.ResourceTeamID = teamT
			allowed, _ = check(t, withTeam)
			assert.True(t, allowed, "matching team id → Allow")
			wrongTeam := base(domain.AuthzPrincipalTypeUser, u, "project", "viewer")
			wrongTeam.ResourceTeamID = teamU
			allowed, _ = check(t, wrongTeam)
			assert.False(t, allowed)
		})

		t.Run("check resource scoped grant does not allow check", func(t *testing.T) {
			u := "user_res_scope_" + uniqueSuffix(t)
			res := "usr_res_chk_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewResourceAssignmentScope(res))))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.False(t, allowed, "no object ids → still deny")
			withRes := base(domain.AuthzPrincipalTypeUser, u, "project", "viewer")
			withRes.ResourceID = res
			allowed, _ = check(t, withRes)
			assert.True(t, allowed, "matching resource id → Allow")
			wrongRes := base(domain.AuthzPrincipalTypeUser, u, "project", "viewer")
			wrongRes.ResourceID = "usr_other_" + uniqueSuffix(t)
			allowed, _ = check(t, wrongRes)
			assert.False(t, allowed)
		})

		t.Run("check wrong catalog deny", func(t *testing.T) {
			u := "user_bad_cat_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())))
			params := base(domain.AuthzPrincipalTypeUser, u, "project", "viewer")
			params.CatalogID = "cat_does_not_exist"
			allowed, foothold := check(t, params)
			assert.False(t, allowed)
			assert.True(t, foothold)
		})

		t.Run("check cross project isolation", func(t *testing.T) {
			u := "user_xproj_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())))
			other := ensureProject(t, d.stmts)
			params := base(domain.AuthzPrincipalTypeUser, u, "project", "viewer")
			params.ProjectID = other
			allowed, foothold := check(t, params)
			assert.False(t, allowed)
			assert.False(t, foothold)
		})

		// --- C. Check — TTU ---
		t.Run("check ttu membership shortcut allow", func(t *testing.T) {
			// SQL arm: TTU membership shortcut (source=team.member + edge on tupleset principal).
			u := "user_ttu_mem_" + uniqueSuffix(t)
			team := "team_ttu_mem_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, team)))
			require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(projectID, team, u)))
			createOwningTeamGrant(t, d.stmts,
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, team, "project", "team", domain.NewProjectAssignmentScope()))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.True(t, allowed)
		})

		t.Run("check ttu membership shortcut not member deny", func(t *testing.T) {
			u := "user_ttu_nomem_" + uniqueSuffix(t)
			team := "team_ttu_nomem_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, team)))
			createOwningTeamGrant(t, d.stmts,
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, team, "project", "team", domain.NewProjectAssignmentScope()))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.False(t, allowed)
		})

		// An expired project.team tupleset row is unrepresentable: the schema
		// CHECK forbids expires_at on owning-team grants (ADR 054 §2, pinned in
		// TestClaimStatements_OwningTeamGrant). writeFullTTUExists still
		// filters tupleset-row expiry, but that branch is now deliberately
		// untested: it only becomes reachable through a custom catalog whose
		// TTU tupleset is not project.team, and the system catalog has no such
		// relation. "check ttu general expired source grant deny" below covers
		// source-grant expiry, not the tupleset row.

		t.Run("check ttu membership shortcut revoked tupleset deny", func(t *testing.T) {
			u := "user_ttu_rev_" + uniqueSuffix(t)
			team := "team_ttu_rev_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, team)))
			require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(projectID, team, u)))
			a := newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, team, "project", "team", domain.NewProjectAssignmentScope())
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), a))
			require.NoError(t, d.stmts.RevokeAuthzAssignment(t.Context(), projectID, a.ID))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.False(t, allowed)
		})

		t.Run("check ttu membership shortcut team principal deny", func(t *testing.T) {
			// Shortcut requires principal_type = user; team principal must not use it.
			team := "team_ttu_prin_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, team)))
			createOwningTeamGrant(t, d.stmts,
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, team, "project", "team", domain.NewProjectAssignmentScope()))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeTeam, team, "project", "viewer"))
			assert.False(t, allowed)
		})

		t.Run("check ttu malformed tupleset principal type deny", func(t *testing.T) {
			// Tupleset project.team must use principal_type=team; a user principal must not participate in TTU.
			u := "user_ttu_badts_" + uniqueSuffix(t)
			createOwningTeamGrant(t, d.stmts,
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "team", domain.NewProjectAssignmentScope()))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "team", "member", domain.NewResourceAssignmentScope(u))))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.False(t, allowed)
		})

		t.Run("check ttu general team scope allow", func(t *testing.T) {
			// SQL arm: general TTU scope_kind=team AND scope_team_id = ts.principal_id.
			u := "user_ttu_gteam_" + uniqueSuffix(t)
			team := "team_ttu_gteam_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, team)))
			createOwningTeamGrant(t, d.stmts,
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, team, "project", "team", domain.NewProjectAssignmentScope()))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "team", "member", domain.NewTeamAssignmentScope(team))))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.True(t, allowed)
		})

		t.Run("check ttu general resource scope allow", func(t *testing.T) {
			// SQL arm: general TTU scope_kind=resource; tupleset principal id equals scope_resource_id.
			u := "user_ttu_gres_" + uniqueSuffix(t)
			team := "team_ttu_gres_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, team)))
			createOwningTeamGrant(t, d.stmts,
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, team, "project", "team", domain.NewProjectAssignmentScope()))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "team", "member", domain.NewResourceAssignmentScope(team))))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.True(t, allowed)
		})

		t.Run("check ttu general project scope object type allow", func(t *testing.T) {
			// SQL arm: scope_kind=project AND a.object_type = edge.source_object_type (team).
			u := "user_ttu_gproj_" + uniqueSuffix(t)
			team := "team_ttu_gproj_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, team)))
			createOwningTeamGrant(t, d.stmts,
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, team, "project", "team", domain.NewProjectAssignmentScope()))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "team", "member", domain.NewProjectAssignmentScope())))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.True(t, allowed)
		})

		t.Run("check ttu general wrong team scope deny", func(t *testing.T) {
			u := "user_ttu_wrong_" + uniqueSuffix(t)
			teamTS := "team_ttu_ts_" + uniqueSuffix(t)
			teamOther := "team_ttu_other_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamTS)))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamOther)))
			createOwningTeamGrant(t, d.stmts,
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, teamTS, "project", "team", domain.NewProjectAssignmentScope()))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "team", "member", domain.NewTeamAssignmentScope(teamOther))))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.False(t, allowed)
		})

		t.Run("check ttu general expired source grant deny", func(t *testing.T) {
			u := "user_ttu_gexp_" + uniqueSuffix(t)
			team := "team_ttu_gexp_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, team)))
			createOwningTeamGrant(t, d.stmts,
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, team, "project", "team", domain.NewProjectAssignmentScope()))
			a := newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "team", "member", domain.NewTeamAssignmentScope(team))
			past := time.Now().Add(-time.Hour)
			a.ExpiresAt = &past
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), a))
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.False(t, allowed)
		})

		// --- D. List ---
		t.Run("list project scope returns all kind", func(t *testing.T) {
			u := "user_list_proj_" + uniqueSuffix(t)
			u1 := "usr_lp1_" + uniqueSuffix(t)
			u2 := "usr_lp2_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(projectID, u1)))
			s2 := domain.NewUserResourceScope(projectID, u2)
			tid := teamT
			s2.TeamID = &tid
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), s2))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())))
			ids := listUsers(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.ElementsMatch(t, []string{u1, u2}, ids)
		})

		t.Run("list stranger empty", func(t *testing.T) {
			res := "usr_str_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(projectID, res)))
			ids := listUsers(t, base(domain.AuthzPrincipalTypeUser, "user_stranger_"+uniqueSuffix(t), "project", "viewer"))
			assert.Empty(t, ids)
		})

		t.Run("list empty when no rsi", func(t *testing.T) {
			u := "user_list_norsi_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())))
			// Fresh project with grant but no user RSI rows created in this case.
			p2 := ensureProject(t, d.stmts)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(p2, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())))
			params := base(domain.AuthzPrincipalTypeUser, u, "project", "viewer")
			params.ProjectID = p2
			ids := listUsers(t, params)
			assert.Empty(t, ids)
		})

		t.Run("list team scope only matching team", func(t *testing.T) {
			u := "user_list_team_" + uniqueSuffix(t)
			localT := "team_lst_" + uniqueSuffix(t)
			localU := "team_lsu_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, localT)))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, localU)))
			onT := "usr_on_t_" + uniqueSuffix(t)
			onU := "usr_on_u_" + uniqueSuffix(t)
			nilTeam := "usr_nil_" + uniqueSuffix(t)
			sT := domain.NewUserResourceScope(projectID, onT)
			sT.TeamID = &localT
			sU := domain.NewUserResourceScope(projectID, onU)
			sU.TeamID = &localU
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), sT))
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), sU))
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(projectID, nilTeam)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewTeamAssignmentScope(localT))))
			ids := listUsers(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.Equal(t, []string{onT}, ids)
		})

		t.Run("list team scoped grant does not leak other teams", func(t *testing.T) {
			u := "user_list_noleak_" + uniqueSuffix(t)
			localT := "team_nlt_" + uniqueSuffix(t)
			localU := "team_nlu_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, localT)))
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, localU)))
			onT := "usr_leak_t_" + uniqueSuffix(t)
			onU := "usr_leak_u_" + uniqueSuffix(t)
			sT := domain.NewUserResourceScope(projectID, onT)
			sT.TeamID = &localT
			sU := domain.NewUserResourceScope(projectID, onU)
			sU.TeamID = &localU
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), sT))
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), sU))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewTeamAssignmentScope(localT))))
			ids := listUsers(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.NotContains(t, ids, onU)
			assert.Contains(t, ids, onT)
		})

		t.Run("list resource scope only that id", func(t *testing.T) {
			u := "user_list_res_" + uniqueSuffix(t)
			r1 := "usr_res1_" + uniqueSuffix(t)
			r2 := "usr_res2_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(projectID, r1)))
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(projectID, r2)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewResourceAssignmentScope(r1))))
			ids := listUsers(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.Equal(t, []string{r1}, ids)
		})

		t.Run("list resource scope does not include siblings", func(t *testing.T) {
			u := "user_list_ressib_" + uniqueSuffix(t)
			r1 := "usr_sib1_" + uniqueSuffix(t)
			r2 := "usr_sib2_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(projectID, r1)))
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(projectID, r2)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewResourceAssignmentScope(r1))))
			ids := listUsers(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.NotContains(t, ids, r2)
		})

		t.Run("list via team expand project grant", func(t *testing.T) {
			u := "user_list_texp_" + uniqueSuffix(t)
			team := "team_list_texp_" + uniqueSuffix(t)
			res := "usr_list_texp_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, team)))
			require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(projectID, team, u)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, team, "project", "viewer", domain.NewProjectAssignmentScope())))
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(projectID, res)))
			ids := listUsers(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.Contains(t, ids, res)
		})

		t.Run("list via ttu membership matches check", func(t *testing.T) {
			u := "user_list_ttu_" + uniqueSuffix(t)
			team := "team_list_ttu_" + uniqueSuffix(t)
			res := "usr_list_ttu_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, team)))
			require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(projectID, team, u)))
			createOwningTeamGrant(t, d.stmts,
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, team, "project", "team", domain.NewProjectAssignmentScope()))
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(projectID, res)))
			params := base(domain.AuthzPrincipalTypeUser, u, "project", "viewer")
			allowed, _ := check(t, params)
			require.True(t, allowed)
			assert.Contains(t, listUsers(t, params), res)
		})

		t.Run("list via ttu general team scope matches check", func(t *testing.T) {
			u := "user_list_gteam_" + uniqueSuffix(t)
			team := "team_list_gteam_" + uniqueSuffix(t)
			res := "usr_list_gteam_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, team)))
			createOwningTeamGrant(t, d.stmts,
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, team, "project", "team", domain.NewProjectAssignmentScope()))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "team", "member", domain.NewTeamAssignmentScope(team))))
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(projectID, res)))
			params := base(domain.AuthzPrincipalTypeUser, u, "project", "viewer")
			allowed, _ := check(t, params)
			require.True(t, allowed)
			assert.Contains(t, listUsers(t, params), res)
		})

		t.Run("list via ttu general resource scope matches check", func(t *testing.T) {
			u := "user_list_gres_" + uniqueSuffix(t)
			team := "team_list_gres_" + uniqueSuffix(t)
			res := "usr_list_gres_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, team)))
			createOwningTeamGrant(t, d.stmts,
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, team, "project", "team", domain.NewProjectAssignmentScope()))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "team", "member", domain.NewResourceAssignmentScope(team))))
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(projectID, res)))
			params := base(domain.AuthzPrincipalTypeUser, u, "project", "viewer")
			allowed, _ := check(t, params)
			require.True(t, allowed)
			assert.Contains(t, listUsers(t, params), res)
		})

		t.Run("list kind filter", func(t *testing.T) {
			u := "user_list_kind_" + uniqueSuffix(t)
			userRes := "usr_kind_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(projectID, userRes)))
			// teamT already has team RSI from CreateTeam dual-write / seed backfill patterns; ensure team scope row.
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewTeamResourceScope(projectID, teamT)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())))
			ids := listUsers(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.Contains(t, ids, userRes)
			assert.NotContains(t, ids, teamT)
		})

		t.Run("list stable order", func(t *testing.T) {
			u := "user_list_ord_" + uniqueSuffix(t)
			// Lexicographically unordered insert order.
			aID := "usr_z_" + uniqueSuffix(t)
			bID := "usr_a_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(projectID, aID)))
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(projectID, bID)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())))
			ids := listUsers(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			sorted := append([]string(nil), ids...)
			sort.Strings(sorted)
			assert.Equal(t, sorted, ids)
		})

		t.Run("list no duplicates", func(t *testing.T) {
			u := "user_list_dedup_" + uniqueSuffix(t)
			res := "usr_dedup_" + uniqueSuffix(t)
			s := domain.NewUserResourceScope(projectID, res)
			s.TeamID = &teamT
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), s))
			// Project-wide + team-scoped grants both match the same RSI row.
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewProjectAssignmentScope())))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, u, "project", "viewer", domain.NewTeamAssignmentScope(teamT))))
			ids := listUsers(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			count := 0
			for _, id := range ids {
				if id == res {
					count++
				}
			}
			assert.Equal(t, 1, count)
		})

		// --- E. Params / home ---
		t.Run("home project id defaults to project", func(t *testing.T) {
			u := "user_home_def_" + uniqueSuffix(t)
			team := "team_home_def_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, team)))
			require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(projectID, team, u)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, team, "project", "viewer", domain.NewProjectAssignmentScope())))
			params := base(domain.AuthzPrincipalTypeUser, u, "project", "viewer")
			params.PrincipalHomeProjectID = ""
			allowed, _ := check(t, params)
			assert.True(t, allowed)
		})

		t.Run("home project mismatch deny expand", func(t *testing.T) {
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
			allowed, _ := check(t, base(domain.AuthzPrincipalTypeUser, u, "project", "viewer"))
			assert.False(t, allowed)
		})
	})
}
