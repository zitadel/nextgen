//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/authz/resolver"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

func TestAuthzAssignment_SKTeamProjectScopeRejected(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		teamID := "team_sk_mint_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))
		a := newTestAssignment(projectID, "", domain.AuthzPrincipalTypeSKTeam, "sk_team_1", "user", "read", domain.NewProjectAssignmentScope())
		assert.ErrorIs(t, d.stmts.CreateAuthzAssignment(t.Context(), a), authz.ErrSKTeamProjectScope)

		ok := newTestAssignment(projectID, "", domain.AuthzPrincipalTypeSKTeam, "sk_team_1", "team", "member", domain.NewTeamAssignmentScope(teamID))
		require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), ok))
	})
}

// TestAuthzSKTeam_OutsideTeamDeny is the compensating deny suite for #831.
// MVP catalog relations are project.{viewer,editor,admin}; a project-scoped
// project.viewer grant is the "somehow holds a project-wide grant" case.
// ConstraintTeamID still limits Check/List to the token team via membership.
func TestAuthzSKTeam_OutsideTeamDeny(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		teamIn := "team_sk_in_" + uniqueSuffix(t)
		teamOut := "team_sk_out_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamIn)))
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamOut)))

		usrIn := "usr_sk_in_" + uniqueSuffix(t)
		usrOut := "usr_sk_out_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(projectID, usrIn)))
		require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(projectID, usrOut)))
		require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(projectID, teamIn, usrIn)))
		require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(projectID, teamOut, usrOut)))

		sk := "sk_team_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
			newTestAssignment(projectID, "", domain.AuthzPrincipalTypeSKTeam, sk, "project", "viewer", domain.NewProjectAssignmentScope())))

		base := domain.AuthzCheckParams{
			CatalogID:        domain.SystemCatalogID,
			ProjectID:        projectID,
			PrincipalType:    domain.AuthzPrincipalTypeSKTeam,
			PrincipalID:      sk,
			ObjectType:       "project",
			Relation:         "viewer",
			ConstraintTeamID: teamIn,
		}

		in := base
		in.ResourceID = usrIn
		out := base
		out.ResourceID = usrOut

		for _, rel := range []string{"viewer", "editor", "admin"} {
			inRel, outRel := in, out
			inRel.Relation = rel
			outRel.Relation = rel
			allowed, foothold, err := d.stmts.CheckAuthz(t.Context(), inRel)
			require.NoError(t, err)
			assert.True(t, allowed, "in-team user must Allow %s", rel)
			assert.True(t, foothold)

			allowed, foothold, err = d.stmts.CheckAuthz(t.Context(), outRel)
			require.NoError(t, err)
			assert.False(t, allowed, "outside-team user must not Allow %s", rel)
			assert.True(t, foothold, "project-wide grant still counts as foothold")
		}

		ids, err := d.stmts.ListAuthzObjectIDs(t.Context(), domain.AuthzListObjectsParams{
			AuthzCheckParams: base,
			ResourceKind:     domain.ResourceKindUser,
		})
		require.NoError(t, err)
		assert.Equal(t, []string{usrIn}, ids)

		persisted, err := d.stmts.LoadCatalogMutations(t.Context(), domain.SystemCatalogID)
		require.NoError(t, err)
		g := resolver.GraphFromPersisted(persisted)
		asgns, err := d.stmts.ListAuthzAssignments(t.Context(), projectID, domain.AuthzPrincipalTypeSKTeam, sk, false)
		require.NoError(t, err)
		g.Assignments = asgns
		g.Memberships = []*domain.AuthzMembershipEdge{
			domain.NewUserTeamMembershipEdge(projectID, teamIn, usrIn),
			domain.NewUserTeamMembershipEdge(projectID, teamOut, usrOut),
		}
		g.Resources = []*domain.ResourceScope{
			domain.NewUserResourceScope(projectID, usrIn),
			domain.NewUserResourceScope(projectID, usrOut),
		}
		assert.Equal(t, allowedFor(t, d, in), g.OracleCheckParams(in))
		assert.Equal(t, allowedFor(t, d, out), g.OracleCheckParams(out))
		assert.ElementsMatch(t, ids, g.OracleListParams(domain.AuthzListObjectsParams{
			AuthzCheckParams: base,
			ResourceKind:     domain.ResourceKindUser,
		}))
	})
}

// TestAuthzSKTeam_NonUserResourceCheckListParity pins that Check and List
// agree for team-scoped non-user RSI rows (RSI.team_id / ResourceTeamID).
func TestAuthzSKTeam_NonUserResourceCheckListParity(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		teamIn := "team_sk_brand_in_" + uniqueSuffix(t)
		teamOut := "team_sk_brand_out_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamIn)))
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamOut)))

		brandIn := "brand_sk_in_" + uniqueSuffix(t)
		brandOut := "brand_sk_out_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), &domain.ResourceScope{
			ResourceID: brandIn, ResourceKind: domain.ResourceKindBranding, ProjectID: projectID, TeamID: &teamIn,
		}))
		require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), &domain.ResourceScope{
			ResourceID: brandOut, ResourceKind: domain.ResourceKindBranding, ProjectID: projectID, TeamID: &teamOut,
		}))

		sk := "sk_team_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
			newTestAssignment(projectID, "", domain.AuthzPrincipalTypeSKTeam, sk, "project", "viewer", domain.NewProjectAssignmentScope())))

		base := domain.AuthzCheckParams{
			CatalogID:        domain.SystemCatalogID,
			ProjectID:        projectID,
			PrincipalType:    domain.AuthzPrincipalTypeSKTeam,
			PrincipalID:      sk,
			ObjectType:       "project",
			Relation:         "viewer",
			ConstraintTeamID: teamIn,
		}
		in := base
		in.ResourceID = brandIn
		in.ResourceTeamID = teamIn
		out := base
		out.ResourceID = brandOut
		out.ResourceTeamID = teamOut

		allowed, foothold, err := d.stmts.CheckAuthz(t.Context(), in)
		require.NoError(t, err)
		assert.True(t, allowed, "in-team branding must Check-allow")
		assert.True(t, foothold)

		allowed, foothold, err = d.stmts.CheckAuthz(t.Context(), out)
		require.NoError(t, err)
		assert.False(t, allowed, "outside-team branding must not Check-allow")
		assert.True(t, foothold)

		ids, err := d.stmts.ListAuthzObjectIDs(t.Context(), domain.AuthzListObjectsParams{
			AuthzCheckParams: base,
			ResourceKind:     domain.ResourceKindBranding,
		})
		require.NoError(t, err)
		assert.Equal(t, []string{brandIn}, ids)

		persisted, err := d.stmts.LoadCatalogMutations(t.Context(), domain.SystemCatalogID)
		require.NoError(t, err)
		g := resolver.GraphFromPersisted(persisted)
		asgns, err := d.stmts.ListAuthzAssignments(t.Context(), projectID, domain.AuthzPrincipalTypeSKTeam, sk, false)
		require.NoError(t, err)
		g.Assignments = asgns
		g.Resources = []*domain.ResourceScope{
			{ResourceID: brandIn, ResourceKind: domain.ResourceKindBranding, ProjectID: projectID, TeamID: &teamIn},
			{ResourceID: brandOut, ResourceKind: domain.ResourceKindBranding, ProjectID: projectID, TeamID: &teamOut},
		}
		assert.Equal(t, allowedFor(t, d, in), g.OracleCheckParams(in))
		assert.Equal(t, allowedFor(t, d, out), g.OracleCheckParams(out))
		assert.ElementsMatch(t, ids, g.OracleListParams(domain.AuthzListObjectsParams{
			AuthzCheckParams: base,
			ResourceKind:     domain.ResourceKindBranding,
		}))
	})
}

func allowedFor(t *testing.T, d dialect, p domain.AuthzCheckParams) bool {
	t.Helper()
	allowed, _, err := d.stmts.CheckAuthz(t.Context(), p)
	require.NoError(t, err)
	return allowed
}
