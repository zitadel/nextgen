//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// ListProjectAdminSources reads who administers a project the way the
// authorization check decides it: active members of the owning team and of
// teams granted admin, and existing users granted admin, through unrevoked,
// unexpired admin grants on that project only.
func TestAuthzAssignmentStatements_ListProjectAdminSources(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		// The people and teams live in their own project, as in the platform
		// project; the grants live on the customer project.
		home, schemaURL := ensureUserTestProject(t, d.stmts)
		projectID := ensureProject(t, d.stmts)
		otherProjectID := ensureProject(t, d.stmts)
		suffix := uniqueSuffix(t)

		user := func(name string) string {
			t.Helper()
			id := "usr-adm-" + name + "-" + suffix
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, home, schemaURL, id, id+"@example.com", name)))
			return id
		}
		team := func(name string, members ...string) string {
			t.Helper()
			id := "team-adm-" + name + "-" + suffix
			require.NoError(t, d.stmts.CreateTeam(t.Context(), &domain.Team{ProjectID: home, ID: id, Name: name}))
			for _, member := range members {
				require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdge(home, id, member)))
			}
			return id
		}
		grant := func(project string, principalType domain.AuthzPrincipalType, principalID, relation string, expiresAt *time.Time) string {
			t.Helper()
			assignment := &domain.AuthzAssignment{
				ProjectID:     project,
				CatalogID:     domain.SystemCatalogID,
				PrincipalType: principalType,
				PrincipalID:   principalID,
				ObjectType:    "project",
				Relation:      relation,
				ExpiresAt:     expiresAt,
			}
			assignment.ApplyScope(domain.NewProjectAssignmentScope())
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), assignment))
			return assignment.ID
		}
		past, future := time.Now().Add(-time.Hour), time.Now().Add(time.Hour)

		// Ids sort a < b < ... so the expected order is readable.
		owner := user("a")
		teamMember := user("b")
		direct := user("c")
		expiring := user("d")
		deleted := user("e")
		viewer := user("f")
		expired := user("g")
		revoked := user("h")
		elsewhere := user("i")
		left := user("j")

		owningTeam := team("owners", owner)
		opsTeam := team("ops", teamMember, owner, left)
		require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), domain.NewClaimTeamAssignment(projectID, owningTeam)))
		opsGrant := grant(projectID, domain.AuthzPrincipalTypeTeam, opsTeam, domain.AuthzRelationAdmin, nil)
		ownerGrant := grant(projectID, domain.AuthzPrincipalTypeUser, owner, domain.AuthzRelationAdmin, nil)
		directGrant := grant(projectID, domain.AuthzPrincipalTypeUser, direct, domain.AuthzRelationAdmin, nil)
		expiringGrant := grant(projectID, domain.AuthzPrincipalTypeUser, expiring, domain.AuthzRelationAdmin, &future)
		grant(projectID, domain.AuthzPrincipalTypeUser, deleted, domain.AuthzRelationAdmin, nil)
		grant(projectID, domain.AuthzPrincipalTypeUser, viewer, "viewer", nil)
		grant(projectID, domain.AuthzPrincipalTypeUser, viewer, "editor", nil)
		grant(projectID, domain.AuthzPrincipalTypeUser, expired, domain.AuthzRelationAdmin, &past)
		require.NoError(t, d.stmts.RevokeAuthzAssignment(t.Context(), projectID,
			grant(projectID, domain.AuthzPrincipalTypeUser, revoked, domain.AuthzRelationAdmin, nil)))
		grant(otherProjectID, domain.AuthzPrincipalTypeUser, elsewhere, domain.AuthzRelationAdmin, nil)
		require.NoError(t, d.stmts.DeleteUserByID(t.Context(), home, deleted))
		require.NoError(t, d.stmts.DeleteAuthzMembershipEdges(t.Context(), edgeFilter(home, domain.AuthzSetTypeTeam, opsTeam, domain.AuthzMemberTypeUser, left)))

		// Every source, then as a viewer in the given teams sees it: a grant to
		// the person and a team the viewer is in are visible and named.
		all := []*domain.ProjectAdminSourceRow{
			{UserID: owner, HomeProjectID: home, OwningTeam: true, TeamID: owningTeam, TeamName: "owners"},
			{UserID: owner, HomeProjectID: home, GrantID: opsGrant, TeamID: opsTeam, TeamName: "ops"},
			{UserID: owner, HomeProjectID: home, GrantID: ownerGrant},
			{UserID: teamMember, HomeProjectID: home, GrantID: opsGrant, TeamID: opsTeam, TeamName: "ops"},
			{UserID: direct, HomeProjectID: home, GrantID: directGrant},
			{UserID: expiring, HomeProjectID: home, GrantID: expiringGrant},
		}
		seenBy := func(teams ...string) []*domain.ProjectAdminSourceRow {
			out := make([]*domain.ProjectAdminSourceRow, 0, len(all))
			for _, row := range all {
				seen := *row
				seen.Visible = seen.TeamID == "" || slices.Contains(teams, seen.TeamID)
				if !seen.Visible {
					seen.TeamName = ""
				}
				out = append(out, &seen)
			}
			return out
		}

		got, err := d.stmts.ListProjectAdminSources(t.Context(), projectID, "", "", 100)
		require.NoError(t, err)
		want := seenBy()
		assert.Equal(t, want, got,
			"by user id, then owning team, team grants and user grants; deleted, viewer, editor, expired, revoked, foreign and departed left out")

		asOwner, err := d.stmts.ListProjectAdminSources(t.Context(), projectID, "", owner, 100)
		require.NoError(t, err)
		assert.Equal(t, seenBy(owningTeam, opsTeam), asOwner, "the owner is in both teams")
		asMember, err := d.stmts.ListProjectAdminSources(t.Context(), projectID, "", teamMember, 100)
		require.NoError(t, err)
		assert.Equal(t, seenBy(opsTeam), asMember, "a member of ops sees ops, not the owning team")
		asLeaver, err := d.stmts.ListProjectAdminSources(t.Context(), projectID, "", left, 100)
		require.NoError(t, err)
		assert.Equal(t, want, asLeaver, "a member who left sees no team")

		limited, err := d.stmts.ListProjectAdminSources(t.Context(), projectID, "", "", 2)
		require.NoError(t, err)
		assert.Equal(t, want[:4], limited, "the limit counts people, and keeps all of their sources")

		next, err := d.stmts.ListProjectAdminSources(t.Context(), projectID, teamMember, "", 2)
		require.NoError(t, err)
		assert.Equal(t, want[4:], next, "a page starts after the given user id")

		pageAsOwner, err := d.stmts.ListProjectAdminSources(t.Context(), projectID, owner, owner, 1)
		require.NoError(t, err)
		assert.Equal(t, seenBy(owningTeam, opsTeam)[3:4], pageAsOwner, "a viewer off the page still decides what is visible")

		none, err := d.stmts.ListProjectAdminSources(t.Context(), otherProjectID+"-missing", "", "", 100)
		require.NoError(t, err)
		assert.Empty(t, none)
	})
}
