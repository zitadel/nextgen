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

// ListProjectAdmins reads who administers a project the way the
// authorization check decides it: active members of the owning team and of
// teams granted admin, and existing users granted admin, through unrevoked,
// unexpired admin grants on that project only.
func TestAuthzAssignmentStatements_ListProjectAdmins(t *testing.T) {
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
		opsGrant := grant(projectID, domain.AuthzPrincipalTypeTeam, opsTeam, "admin", nil)
		ownerGrant := grant(projectID, domain.AuthzPrincipalTypeUser, owner, "admin", nil)
		directGrant := grant(projectID, domain.AuthzPrincipalTypeUser, direct, "admin", nil)
		expiringGrant := grant(projectID, domain.AuthzPrincipalTypeUser, expiring, "admin", &future)
		grant(projectID, domain.AuthzPrincipalTypeUser, deleted, "admin", nil)
		grant(projectID, domain.AuthzPrincipalTypeUser, viewer, "viewer", nil)
		grant(projectID, domain.AuthzPrincipalTypeUser, viewer, "editor", nil)
		grant(projectID, domain.AuthzPrincipalTypeUser, expired, "admin", &past)
		require.NoError(t, d.stmts.RevokeAuthzAssignment(t.Context(), projectID,
			grant(projectID, domain.AuthzPrincipalTypeUser, revoked, "admin", nil)))
		grant(otherProjectID, domain.AuthzPrincipalTypeUser, elsewhere, "admin", nil)
		require.NoError(t, d.stmts.DeleteUserByID(t.Context(), home, deleted))
		require.NoError(t, d.stmts.DeleteAuthzMembershipEdges(t.Context(), edgeFilter(home, domain.AuthzSetTypeTeam, opsTeam, domain.AuthzMemberTypeUser, left)))

		// Every source, then as a viewer in the given teams sees it: a grant to
		// the person and a team the viewer is in are visible and named.
		type person struct {
			userID  string
			sources []domain.ProjectAdminSourceRecord
		}
		all := []person{
			{owner, []domain.ProjectAdminSourceRecord{
				{OwningTeam: true, TeamID: owningTeam, TeamName: "owners"},
				{GrantID: opsGrant, TeamID: opsTeam, TeamName: "ops"},
				{GrantID: ownerGrant},
			}},
			{teamMember, []domain.ProjectAdminSourceRecord{{GrantID: opsGrant, TeamID: opsTeam, TeamName: "ops"}}},
			{direct, []domain.ProjectAdminSourceRecord{{GrantID: directGrant}}},
			{expiring, []domain.ProjectAdminSourceRecord{{GrantID: expiringGrant}}},
		}
		// seenBy is the admins a viewer in the given teams sees: a person with
		// a grant of their own, or in one of those teams, with every source,
		// and only those teams named.
		seenBy := func(teams ...string) []*domain.ProjectAdminRecord {
			out := make([]*domain.ProjectAdminRecord, 0, len(all))
			for _, p := range all {
				record := &domain.ProjectAdminRecord{UserID: p.userID, HomeProjectID: home}
				seen := false
				for _, source := range p.sources {
					visible := source.TeamID == "" || slices.Contains(teams, source.TeamID)
					if !visible {
						source.TeamName = ""
					}
					seen = seen || visible
					record.Sources = append(record.Sources, source)
				}
				if seen {
					out = append(out, record)
				}
			}
			return out
		}

		got, err := d.stmts.ListProjectAdmins(t.Context(), projectID, "", "", 100)
		require.NoError(t, err)
		want := seenBy()
		assert.Equal(t, want, got,
			"by user id, sources owning team, team grants and user grants; deleted, viewer, editor, expired, revoked, foreign and departed left out")
		assert.NotContains(t, adminUserIDs(got), teamMember, "a person only in a team the viewer is not in is left out")

		asOwner, err := d.stmts.ListProjectAdmins(t.Context(), projectID, "", owner, 100)
		require.NoError(t, err)
		assert.Equal(t, seenBy(owningTeam, opsTeam), asOwner, "the owner is in both teams")
		asMember, err := d.stmts.ListProjectAdmins(t.Context(), projectID, "", teamMember, 100)
		require.NoError(t, err)
		assert.Equal(t, seenBy(opsTeam), asMember, "a member of ops sees ops, not the owning team")
		asLeaver, err := d.stmts.ListProjectAdmins(t.Context(), projectID, "", left, 100)
		require.NoError(t, err)
		assert.Equal(t, want, asLeaver, "a member who left sees no team")

		limited, err := d.stmts.ListProjectAdmins(t.Context(), projectID, "", "", 2)
		require.NoError(t, err)
		assert.Equal(t, want[:2], limited, "the limit counts the people listed, and keeps all of their sources")

		next, err := d.stmts.ListProjectAdmins(t.Context(), projectID, direct, "", 2)
		require.NoError(t, err)
		assert.Equal(t, want[2:], next, "a page starts after the given user id")

		pageAsOwner, err := d.stmts.ListProjectAdmins(t.Context(), projectID, owner, owner, 1)
		require.NoError(t, err)
		assert.Equal(t, seenBy(owningTeam, opsTeam)[1:2], pageAsOwner, "a viewer off the page still decides who is listed")

		none, err := d.stmts.ListProjectAdmins(t.Context(), otherProjectID+"-missing", "", "", 100)
		require.NoError(t, err)
		assert.Empty(t, none)
	})
}

func adminUserIDs(records []*domain.ProjectAdminRecord) []string {
	ids := make([]string, 0, len(records))
	for _, record := range records {
		ids = append(ids, record.UserID)
	}
	return ids
}
