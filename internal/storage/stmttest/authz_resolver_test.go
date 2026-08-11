//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestAuthzResolverStatements_Smoke(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("active system catalog", func(t *testing.T) {
			id, err := d.stmts.ActiveSystemCatalogID(t.Context())
			require.NoError(t, err)
			assert.Equal(t, domain.SystemCatalogID, id)
		})

		projectID := ensureProject(t, d.stmts)
		userID := "user_resolver_" + uniqueSuffix(t)
		teamID := "team_resolver_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))

		t.Run("foothold none", func(t *testing.T) {
			ok, err := d.stmts.HasAuthzProjectFoothold(t.Context(), projectID, domain.AuthzPrincipalTypeUser, userID)
			require.NoError(t, err)
			assert.False(t, ok)
		})

		t.Run("direct grant check allow deny revoke", func(t *testing.T) {
			a := newTestAssignment(projectID, "asgn-"+uniqueSuffix(t), domain.AuthzPrincipalTypeUser, userID, "project", "viewer", domain.NewProjectAssignmentScope())
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), a))

			ok, err := d.stmts.HasAuthzProjectFoothold(t.Context(), projectID, domain.AuthzPrincipalTypeUser, userID)
			require.NoError(t, err)
			assert.True(t, ok)

			allowed, _, err := d.stmts.CheckAuthz(t.Context(), domain.AuthzCheckParams{
				CatalogID:     domain.SystemCatalogID,
				ProjectID:     projectID,
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   userID,
				ObjectType:    "project",
				Relation:      "viewer",
			})
			require.NoError(t, err)
			assert.True(t, allowed)

			denied, _, err := d.stmts.CheckAuthz(t.Context(), domain.AuthzCheckParams{
				CatalogID:     domain.SystemCatalogID,
				ProjectID:     projectID,
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   userID,
				ObjectType:    "team",
				Relation:      "member",
			})
			require.NoError(t, err)
			assert.False(t, denied)

			require.NoError(t, d.stmts.RevokeAuthzAssignment(t.Context(), projectID, a.ID))
			afterRevoke, _, err := d.stmts.CheckAuthz(t.Context(), domain.AuthzCheckParams{
				CatalogID:     domain.SystemCatalogID,
				ProjectID:     projectID,
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   userID,
				ObjectType:    "project",
				Relation:      "viewer",
			})
			require.NoError(t, err)
			assert.False(t, afterRevoke)
		})

		t.Run("team grant via membership edge", func(t *testing.T) {
			member := "user_teamgrant_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(projectID, teamID, member)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "asgn-"+uniqueSuffix(t), domain.AuthzPrincipalTypeTeam, teamID, "project", "viewer", domain.NewProjectAssignmentScope())))

			allowed, _, err := d.stmts.CheckAuthz(t.Context(), domain.AuthzCheckParams{
				CatalogID:     domain.SystemCatalogID,
				ProjectID:     projectID,
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   member,
				ObjectType:    "project",
				Relation:      "viewer",
			})
			require.NoError(t, err)
			assert.True(t, allowed)

			ok, err := d.stmts.HasAuthzProjectFoothold(t.Context(), projectID, domain.AuthzPrincipalTypeUser, member)
			require.NoError(t, err)
			assert.True(t, ok)
		})

		t.Run("ttu via project.team tupleset and membership", func(t *testing.T) {
			ttuUser := "user_ttu_" + uniqueSuffix(t)
			ttuTeam := "team_ttu_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, ttuTeam)))
			require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(projectID, ttuTeam, ttuUser)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "asgn-"+uniqueSuffix(t), domain.AuthzPrincipalTypeTeam, ttuTeam, "project", "team", domain.NewProjectAssignmentScope())))

			allowed, _, err := d.stmts.CheckAuthz(t.Context(), domain.AuthzCheckParams{
				CatalogID:     domain.SystemCatalogID,
				ProjectID:     projectID,
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   ttuUser,
				ObjectType:    "project",
				Relation:      "viewer",
			})
			require.NoError(t, err)
			assert.True(t, allowed)
		})

		t.Run("expired grant denied", func(t *testing.T) {
			expiredUser := "user_exp_" + uniqueSuffix(t)
			a := newTestAssignment(projectID, "asgn-"+uniqueSuffix(t), domain.AuthzPrincipalTypeUser, expiredUser, "project", "viewer", domain.NewProjectAssignmentScope())
			past := time.Now().Add(-time.Hour)
			a.ExpiresAt = &past
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), a))

			allowed, _, err := d.stmts.CheckAuthz(t.Context(), domain.AuthzCheckParams{
				CatalogID:     domain.SystemCatalogID,
				ProjectID:     projectID,
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   expiredUser,
				ObjectType:    "project",
				Relation:      "viewer",
			})
			require.NoError(t, err)
			assert.False(t, allowed)
		})

		t.Run("list object ids project scoped", func(t *testing.T) {
			listUser := "user_list_" + uniqueSuffix(t)
			u1 := "usr_list_1_" + uniqueSuffix(t)
			u2 := "usr_list_2_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(projectID, u1)))
			u2Scope := domain.NewUserResourceScope(projectID, u2)
			tid := teamID
			u2Scope.TeamID = &tid
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), u2Scope))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "asgn-"+uniqueSuffix(t), domain.AuthzPrincipalTypeUser, listUser, "project", "viewer", domain.NewProjectAssignmentScope())))

			ids, err := d.stmts.ListAuthzObjectIDs(t.Context(), domain.AuthzListObjectsParams{
				AuthzCheckParams: domain.AuthzCheckParams{
					CatalogID:     domain.SystemCatalogID,
					ProjectID:     projectID,
					PrincipalType: domain.AuthzPrincipalTypeUser,
					PrincipalID:   listUser,
					ObjectType:    "project",
					Relation:      "viewer",
				},
				ResourceKind: domain.ResourceKindUser,
			})
			require.NoError(t, err)
			assert.ElementsMatch(t, []string{u1, u2}, ids)

			stranger := "user_stranger_" + uniqueSuffix(t)
			empty, err := d.stmts.ListAuthzObjectIDs(t.Context(), domain.AuthzListObjectsParams{
				AuthzCheckParams: domain.AuthzCheckParams{
					CatalogID:     domain.SystemCatalogID,
					ProjectID:     projectID,
					PrincipalType: domain.AuthzPrincipalTypeUser,
					PrincipalID:   stranger,
					ObjectType:    "project",
					Relation:      "viewer",
				},
				ResourceKind: domain.ResourceKindUser,
			})
			require.NoError(t, err)
			assert.Empty(t, empty)
		})

		t.Run("list via TTU matches check", func(t *testing.T) {
			ttuUser := "user_list_ttu_" + uniqueSuffix(t)
			ttuTeam := "team_list_ttu_" + uniqueSuffix(t)
			resID := "usr_list_ttu_" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, ttuTeam)))
			require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(projectID, ttuTeam, ttuUser)))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "asgn-"+uniqueSuffix(t), domain.AuthzPrincipalTypeTeam, ttuTeam, "project", "team", domain.NewProjectAssignmentScope())))
			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), domain.NewUserResourceScope(projectID, resID)))

			params := domain.AuthzCheckParams{
				CatalogID:     domain.SystemCatalogID,
				ProjectID:     projectID,
				PrincipalType: domain.AuthzPrincipalTypeUser,
				PrincipalID:   ttuUser,
				ObjectType:    "project",
				Relation:      "viewer",
			}
			allowed, _, err := d.stmts.CheckAuthz(t.Context(), params)
			require.NoError(t, err)
			require.True(t, allowed)

			ids, err := d.stmts.ListAuthzObjectIDs(t.Context(), domain.AuthzListObjectsParams{
				AuthzCheckParams: domain.AuthzCheckParams{
					CatalogID:     domain.SystemCatalogID,
					ProjectID:     projectID,
					PrincipalType: domain.AuthzPrincipalTypeUser,
					PrincipalID:   ttuUser,
					ObjectType:    "project",
					Relation:      "viewer",
				},
				ResourceKind: domain.ResourceKindUser,
			})
			require.NoError(t, err)
			assert.Contains(t, ids, resID)
		})
	})
}
