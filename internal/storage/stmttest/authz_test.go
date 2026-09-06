//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/authz/compiler"
	"github.com/zitadel/nextgen/internal/authz/openfga"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestAuthzAssignmentStatements_CRUD(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		teamID := "team-asgn-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))

		t.Run("system catalog grant and unknown relation", func(t *testing.T) {
			a := newTestAssignment(projectID, "asgn-"+uniqueSuffix(t), domain.AuthzPrincipalTypeUser, "user_alice", "project", "viewer", domain.NewProjectAssignmentScope())
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), a))
			assert.False(t, a.CreatedAt.IsZero())

			got, err := d.stmts.GetAuthzAssignment(t.Context(), projectID, a.ID)
			require.NoError(t, err)
			assert.Equal(t, "project", got.ObjectType)
			assert.Equal(t, "viewer", got.Relation)
			assert.Equal(t, domain.AuthzScopeKindProject, got.ScopeKind)

			bad := newTestAssignment(projectID, "asgn-"+uniqueSuffix(t), domain.AuthzPrincipalTypeUser, "user_x", "project", "not.a.relation", domain.NewProjectAssignmentScope())
			assert.Error(t, d.stmts.CreateAuthzAssignment(t.Context(), bad))
		})

		t.Run("empty id is dialect-minted", func(t *testing.T) {
			a := newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, "user_mint", "project", "viewer", domain.NewProjectAssignmentScope())
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), a))
			assert.True(t, strings.HasPrefix(a.ID, string(domain.PrefixAuthzAssignment)+"_"))
			got, err := d.stmts.GetAuthzAssignment(t.Context(), projectID, a.ID)
			require.NoError(t, err)
			assert.Equal(t, a.ID, got.ID)
		})

		t.Run("team-scoped and resource-scoped grants", func(t *testing.T) {
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "asgn-"+uniqueSuffix(t), domain.AuthzPrincipalTypeUser, "user_bob", "project", "viewer", domain.NewTeamAssignmentScope(teamID))))

			resourceID := "usr-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "asgn-"+uniqueSuffix(t), domain.AuthzPrincipalTypeUser, "user_carol", "project", "viewer", domain.NewResourceAssignmentScope(resourceID))))
		})

		t.Run("illegal scope combo rejected", func(t *testing.T) {
			a := newTestAssignment(projectID, "asgn-"+uniqueSuffix(t), domain.AuthzPrincipalTypeUser, "user_bad", "project", "viewer", domain.NewProjectAssignmentScope())
			teamScope := teamID
			a.ScopeTeamID = &teamScope // illegal with project scope
			assert.ErrorIs(t, d.stmts.CreateAuthzAssignment(t.Context(), a), new(database.CheckError))
		})

		t.Run("unique active and soft revoke", func(t *testing.T) {
			id1 := "asgn-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, id1, domain.AuthzPrincipalTypeUser, "user_dup", "project", "viewer", domain.NewProjectAssignmentScope())))

			dup := newTestAssignment(projectID, "asgn-"+uniqueSuffix(t), domain.AuthzPrincipalTypeUser, "user_dup", "project", "viewer", domain.NewProjectAssignmentScope())
			assert.ErrorIs(t, d.stmts.CreateAuthzAssignment(t.Context(), dup), new(database.UniqueError))

			require.NoError(t, d.stmts.RevokeAuthzAssignment(t.Context(), projectID, id1))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), dup))

			listed, err := d.stmts.ListAuthzAssignments(t.Context(), projectID, domain.AuthzPrincipalTypeUser, "user_dup", false)
			require.NoError(t, err)
			require.Len(t, listed, 1)
			assert.Nil(t, listed[0].RevokedAt)

			listedAll, err := d.stmts.ListAuthzAssignments(t.Context(), projectID, domain.AuthzPrincipalTypeUser, "user_dup", true)
			require.NoError(t, err)
			require.Len(t, listedAll, 2)
		})

		t.Run("delegation check", func(t *testing.T) {
			grantor := "user_grantor"
			a := newTestAssignment(projectID, "asgn-"+uniqueSuffix(t), domain.AuthzPrincipalTypeAgent, "agent_1", "project", "viewer", domain.NewProjectAssignmentScope())
			a.GrantorID = &grantor // grantor without delegation_id must fail CHECK
			assert.ErrorIs(t, d.stmts.CreateAuthzAssignment(t.Context(), a), new(database.CheckError))

			delegation := "dlg-" + uniqueSuffix(t)
			a.DelegationID = &delegation
			a.GrantorType = strPtr(domain.AuthzPrincipalTypeUser.String())
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), a))
		})
	})
}

func TestAuthzAssignmentStatements_ListManagedGrants(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		teamID := "team-mgr-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))

		userGrant := newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, "user_mgr_"+uniqueSuffix(t), "project", "viewer", domain.NewProjectAssignmentScope())
		require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), userGrant))

		teamGrant := newTestAssignment(projectID, "", domain.AuthzPrincipalTypeTeam, teamID, "project", "editor", domain.NewProjectAssignmentScope())
		require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), teamGrant))

		expired := time.Now().Add(-time.Hour)
		expiredGrant := newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, "user_exp_"+uniqueSuffix(t), "project", "admin", domain.NewProjectAssignmentScope())
		expiredGrant.ExpiresAt = &expired
		require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), expiredGrant))

		revokedGrant := newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, "user_rev_"+uniqueSuffix(t), "project", "viewer", domain.NewProjectAssignmentScope())
		require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), revokedGrant))
		require.NoError(t, d.stmts.RevokeAuthzAssignment(t.Context(), projectID, revokedGrant.ID))

		require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), domain.NewSKProjProjectSetupAssignment(projectID)))
		require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), domain.NewClaimTeamAssignment(projectID, teamID)))

		teamScoped := newTestAssignment(projectID, "", domain.AuthzPrincipalTypeUser, "user_ts_"+uniqueSuffix(t), "project", "viewer", domain.NewTeamAssignmentScope(teamID))
		require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), teamScoped))

		model, err := openfga.ParseDSL(sampleCatalogOpenFGAModel)
		require.NoError(t, err)
		output, err := compiler.Compile(model)
		require.NoError(t, err)
		appCatalogID := fmt.Sprintf("cat_app_%s", uniqueSuffix(t))
		require.NoError(t, d.stmts.PersistCatalogVersion(t.Context(), domain.AuthzCatalogVersion{
			ID: appCatalogID, CatalogKind: domain.AuthzCatalogKindAppGroup, OwnerID: "owner_" + uniqueSuffix(t), Version: 1,
		}, output.Catalog))
		appGrant := &domain.AuthzAssignment{
			ProjectID: projectID, CatalogID: appCatalogID,
			PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: "user_app_" + uniqueSuffix(t),
			ObjectType: "project", Relation: "viewer",
		}
		appGrant.ApplyScope(domain.NewProjectAssignmentScope())
		require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), appGrant))

		listed, err := d.stmts.ListManagedGrants(t.Context(), projectID, &database.ListOptions[domain.AuthzAssignmentField]{
			Pagination: database.Page[domain.AuthzAssignmentField]{
				Limit: 20,
				OrderBy: database.OrderBy[domain.AuthzAssignmentField]{
					Columns:   []database.Column[domain.AuthzAssignmentField]{database.Col(domain.AuthzAssignmentFieldID)},
					Direction: database.OrderAsc,
				},
			},
		})
		require.NoError(t, err)

		got := make(map[string]*domain.AuthzAssignment, len(listed.Items))
		for _, a := range listed.Items {
			got[a.ID] = a
		}
		assert.Contains(t, got, userGrant.ID)
		assert.Contains(t, got, teamGrant.ID)
		assert.Contains(t, got, expiredGrant.ID)
		assert.NotContains(t, got, revokedGrant.ID)
		assert.NotContains(t, got, teamScoped.ID)
		assert.NotContains(t, got, appGrant.ID)
		assert.Len(t, listed.Items, 3)

		otherProject := ensureProject(t, d.stmts)
		otherGrant := newTestAssignment(otherProject, "", domain.AuthzPrincipalTypeUser, "user_other_"+uniqueSuffix(t), "project", "viewer", domain.NewProjectAssignmentScope())
		require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), otherGrant))

		scoped, err := d.stmts.ListManagedGrants(t.Context(), projectID, &database.ListOptions[domain.AuthzAssignmentField]{
			Pagination: database.Page[domain.AuthzAssignmentField]{
				Limit: 20,
				OrderBy: database.OrderBy[domain.AuthzAssignmentField]{
					Columns:   []database.Column[domain.AuthzAssignmentField]{database.Col(domain.AuthzAssignmentFieldID)},
					Direction: database.OrderAsc,
				},
			},
		})
		require.NoError(t, err)
		for _, a := range scoped.Items {
			assert.NotEqual(t, otherGrant.ID, a.ID)
			assert.Equal(t, projectID, a.ProjectID)
		}

		_, err = d.stmts.ListManagedGrants(t.Context(), "", &database.ListOptions[domain.AuthzAssignmentField]{
			Pagination: database.Page[domain.AuthzAssignmentField]{Limit: 1},
		})
		require.Error(t, err)
	})
}

func newTestAssignment(projectID, id string, principalType domain.AuthzPrincipalType, principalID, objectType, relation string, scope domain.AuthzAssignmentScope) *domain.AuthzAssignment {
	a := &domain.AuthzAssignment{
		ID: id, ProjectID: projectID, CatalogID: domain.SystemCatalogID,
		PrincipalType: principalType, PrincipalID: principalID,
		ObjectType: objectType, Relation: relation,
	}
	a.ApplyScope(scope)
	return a
}

func strPtr(s string) *string { return &s }
