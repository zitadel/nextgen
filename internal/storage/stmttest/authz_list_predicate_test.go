//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

func TestAuthzListPredicate_Teams(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		teamIn := "team-in-" + uniqueSuffix(t)
		teamOut := "team-out-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamIn)))
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamOut)))

		viewer := "usr-viewer-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, viewer, viewer+"@example.com", "Viewer")))

		catalogID, err := d.stmts.ActiveSystemCatalogID(t.Context())
		require.NoError(t, err)

		listTeams := func(ctx context.Context) []string {
			t.Helper()
			res, err := d.stmts.ListTeams(ctx, &database.ListOptions[domain.TeamField]{
				Filter: database.Equal(database.Col(domain.TeamFieldProjectID), projectID),
			})
			require.NoError(t, err)
			ids := make([]string, 0, len(res.Items))
			for _, team := range res.Items {
				ids = append(ids, team.ID)
			}
			return ids
		}

		t.Run("empty authz yields empty page", func(t *testing.T) {
			ctx := service.WithAuthzListFilter(t.Context(), service.AuthzListFilter{
				AuthzCheckParams: domain.AuthzCheckParams{
					CatalogID: catalogID, ProjectID: projectID, PrincipalHomeProjectID: projectID,
					PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: viewer,
					ObjectType: "project", Relation: "viewer",
				},
				ResourceKind: domain.ResourceKindTeam,
			})
			assert.Empty(t, listTeams(ctx))
		})

		t.Run("project-wide grant sees all teams", func(t *testing.T) {
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "asgn-"+uniqueSuffix(t), domain.AuthzPrincipalTypeUser, viewer, "project", "viewer", domain.NewProjectAssignmentScope())))
			ctx := service.WithAuthzListFilter(t.Context(), service.AuthzListFilter{
				AuthzCheckParams: domain.AuthzCheckParams{
					CatalogID: catalogID, ProjectID: projectID, PrincipalHomeProjectID: projectID,
					PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: viewer,
					ObjectType: "project", Relation: "viewer",
				},
				ResourceKind: domain.ResourceKindTeam,
			})
			assert.ElementsMatch(t, []string{teamIn, teamOut}, listTeams(ctx))
		})

		t.Run("team-scoped grant hides out-of-team rows", func(t *testing.T) {
			scoped := "usr-scoped-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, scoped, scoped+"@example.com", "Scoped")))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "asgn-"+uniqueSuffix(t), domain.AuthzPrincipalTypeUser, scoped, "project", "viewer", domain.NewTeamAssignmentScope(teamIn))))

			ctx := service.WithAuthzListFilter(t.Context(), service.AuthzListFilter{
				AuthzCheckParams: domain.AuthzCheckParams{
					CatalogID: catalogID, ProjectID: projectID, PrincipalHomeProjectID: projectID,
					PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: scoped,
					ObjectType: "project", Relation: "viewer",
				},
				ResourceKind: domain.ResourceKindTeam,
			})
			assert.Equal(t, []string{teamIn}, listTeams(ctx))
		})
	})
}

func TestAuthzListPredicate_Users(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		u1 := "usr-list-1-" + uniqueSuffix(t)
		u2 := "usr-list-2-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, u1, u1+"@example.com", "One")))
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, u2, u2+"@example.com", "Two")))

		principal := "usr-principal-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, principal, principal+"@example.com", "Principal")))

		catalogID, err := d.stmts.ActiveSystemCatalogID(t.Context())
		require.NoError(t, err)

		listUsers := func(ctx context.Context) []string {
			t.Helper()
			res, err := d.stmts.ListUsers(ctx, &database.ListOptions[domain.UserField]{
				Filter: database.Equal(database.Col(domain.UserFieldProjectID), projectID),
			}, service.UserQueryOptions{})
			require.NoError(t, err)
			ids := make([]string, 0, len(res.Items))
			for _, u := range res.Items {
				ids = append(ids, u.ID)
			}
			return ids
		}

		t.Run("empty authz yields empty page", func(t *testing.T) {
			ctx := service.WithAuthzListFilter(t.Context(), service.AuthzListFilter{
				AuthzCheckParams: domain.AuthzCheckParams{
					CatalogID: catalogID, ProjectID: projectID, PrincipalHomeProjectID: projectID,
					PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: principal,
					ObjectType: "project", Relation: "viewer",
				},
				ResourceKind: domain.ResourceKindUser,
			})
			assert.Empty(t, listUsers(ctx))
		})

		t.Run("project-wide grant sees all users", func(t *testing.T) {
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(projectID, "asgn-"+uniqueSuffix(t), domain.AuthzPrincipalTypeUser, principal, "project", "viewer", domain.NewProjectAssignmentScope())))
			ctx := service.WithAuthzListFilter(t.Context(), service.AuthzListFilter{
				AuthzCheckParams: domain.AuthzCheckParams{
					CatalogID: catalogID, ProjectID: projectID, PrincipalHomeProjectID: projectID,
					PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: principal,
					ObjectType: "project", Relation: "viewer",
				},
				ResourceKind: domain.ResourceKindUser,
			})
			got := listUsers(ctx)
			assert.Contains(t, got, u1)
			assert.Contains(t, got, u2)
			assert.Contains(t, got, principal)
		})
	})
}

func TestAuthzListUsers_RequiresFilter(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := ensureUserTestProject(t, d.stmts)
		_, err := d.stmts.ListUsers(t.Context(), &database.ListOptions[domain.UserField]{
			Filter: database.Equal(database.Col(domain.UserFieldProjectID), projectID),
		}, service.UserQueryOptions{})
		require.ErrorIs(t, err, authz.ErrListFilterRequired)
	})
}
