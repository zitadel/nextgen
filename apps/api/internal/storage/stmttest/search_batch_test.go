//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// A search across projects asks three statements one question each for every
// project at once (ADR 087 §6): the check, the search entries and the user
// search index. Each answers per project exactly what its one-project form
// answers, and each range still stops at its limit.
func TestSearchAcrossProjectsStatements(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		granted, grantedSchema := ensureUserTestProject(t, d.stmts)
		scopedProject, _ := ensureUserTestProject(t, d.stmts)
		foreign, _ := ensureUserTestProject(t, d.stmts)

		t.Run("one check answers every project as its own check does", func(t *testing.T) {
			viewer := "usr-batch-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, granted, grantedSchema, viewer, viewer+"@example.com", "Viewer")))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(granted, "asgn-"+uniqueSuffix(t), domain.AuthzPrincipalTypeUser, viewer, "project", "viewer", domain.NewProjectAssignmentScope())))
			team := &domain.Team{ProjectID: scopedProject, Name: "Batch Scoped"}
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(),
				newTestAssignment(scopedProject, "asgn-"+uniqueSuffix(t), domain.AuthzPrincipalTypeUser, viewer, "project", "viewer", domain.NewTeamAssignmentScope(team.ID))))
			catalogID, err := d.stmts.ActiveSystemCatalogID(t.Context())
			require.NoError(t, err)
			params := domain.AuthzCheckParams{
				CatalogID: catalogID, PrincipalHomeProjectID: granted,
				PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: viewer,
				ObjectType: "project", Relation: "viewer",
			}
			projects := []string{foreign, granted, scopedProject}
			batch, err := d.stmts.CheckAuthzProjects(t.Context(), params, projects)
			require.NoError(t, err)
			require.Len(t, batch, len(projects))
			for i, projectID := range projects {
				one := params
				one.ProjectID = projectID
				allowed, foothold, err := d.stmts.CheckAuthz(t.Context(), one)
				require.NoError(t, err)
				assert.Equal(t, domain.AuthzCheckResult{Allowed: allowed, Foothold: foothold}, batch[i], projectID)
			}
			assert.Equal(t, domain.AuthzCheckResult{Allowed: true, Foothold: true}, batch[1], "a project-wide grant")
			assert.Equal(t, domain.AuthzCheckResult{Foothold: true}, batch[2], "a grant on one team")
			assert.Equal(t, domain.AuthzCheckResult{}, batch[0], "no grant")
		})

		t.Run("one read of the entries holds each project and kind, each to its limit", func(t *testing.T) {
			for _, name := range []string{"Rocket One", "Rocket Two", "Rocket Three"} {
				require.NoError(t, d.stmts.CreateTeam(t.Context(), &domain.Team{ProjectID: granted, Name: name}))
			}
			require.NoError(t, d.stmts.CreateTeam(t.Context(), &domain.Team{ProjectID: foreign, Name: "Rocket Elsewhere"}))
			createFlowDefinitionRevision(t, d.stmts, foreign, "flowdef_"+uniqueSuffix(t), "rocket-sign-in")

			ranges, err := d.stmts.SearchEntriesInProjects(unfilteredListCtx(t), []string{granted, foreign},
				[]domain.ResourceKind{domain.ResourceKindTeam, domain.ResourceKindFlowDefinition}, "rocket", 2)
			require.NoError(t, err)
			require.Len(t, ranges, 4)
			texts := func(r domain.SearchEntryRange) []string {
				out := make([]string, 0, len(r.Matches))
				for _, m := range r.Matches {
					assert.Equal(t, r.ProjectID, m.ProjectID)
					out = append(out, m.MatchedText)
				}
				return out
			}
			assert.Equal(t, domain.ResourceKindTeam, ranges[0].Kind)
			assert.Equal(t, granted, ranges[0].ProjectID)
			assert.Equal(t, []string{"rocket one", "rocket three"}, texts(ranges[0]))
			assert.True(t, ranges[0].Full)
			assert.Empty(t, texts(ranges[1]), "the granted project holds no rocket flow")
			assert.Equal(t, []string{"rocket elsewhere"}, texts(ranges[2]))
			assert.False(t, ranges[2].Full)
			assert.Equal(t, []string{"rocket-sign-in"}, texts(ranges[3]))
		})

		t.Run("one read of the user search index holds each project and property", func(t *testing.T) {
			for _, spec := range []struct{ project, id, email, name string }{
				{granted, "user_batch_ada", "ada@example.com", "Rowan"},
				{granted, "user_batch_adam", "adam@example.com", "Ada"},
				{foreign, "user_batch_far", "ada.far@example.com", "Far"},
			} {
				schema := grantedSchema
				if spec.project == foreign {
					schema = "https://example.com/schemas/test-user"
				}
				require.NoError(t, d.stmts.CreateUser(t.Context(), newSearchableTestUser(t, spec.project, schema, spec.id, spec.email, spec.name)))
			}
			ranges, err := d.stmts.SearchUserIndex(unfilteredListCtx(t), []domain.UserSearchRange{
				{ProjectID: granted, Key: "email"},
				{ProjectID: granted, Key: "name"},
				{ProjectID: foreign, Key: "email"},
			}, "ada", 1)
			require.NoError(t, err)
			require.Len(t, ranges, 3)
			assert.Equal(t, []domain.UserSearchHit{{UserID: "user_batch_ada", MatchedText: "ada@example.com"}}, ranges[0].Hits)
			assert.True(t, ranges[0].Full, "adam@ is further along the range")
			assert.Equal(t, []domain.UserSearchHit{{UserID: "user_batch_adam", MatchedText: "ada"}}, ranges[1].Hits)
			assert.Equal(t, []domain.UserSearchHit{{UserID: "user_batch_far", MatchedText: "ada.far@example.com"}}, ranges[2].Hits)
		})

		t.Run("both reads across projects refuse a list filter", func(t *testing.T) {
			ctx := service.WithAuthzListFilter(t.Context(), service.AuthzListFilter{ResourceKind: domain.ResourceKindTeam})
			_, err := d.stmts.SearchEntriesInProjects(ctx, []string{granted}, []domain.ResourceKind{domain.ResourceKindTeam}, "a", 5)
			require.ErrorIs(t, err, service.ErrListFilterUnsupported)
			_, err = d.stmts.SearchUserIndex(ctx, []domain.UserSearchRange{{ProjectID: granted, Key: "email"}}, "a", 5)
			require.ErrorIs(t, err, service.ErrListFilterUnsupported)
		})
	})
}
