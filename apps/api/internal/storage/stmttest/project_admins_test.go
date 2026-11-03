//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
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
		// A delegated row is a second admin row for the same person; it must
		// not take a second place on a page.
		delegated := &domain.AuthzAssignment{
			ProjectID: projectID, CatalogID: domain.SystemCatalogID,
			PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: direct,
			ObjectType: "project", Relation: "admin",
			GrantorType: new("user"), GrantorID: new(owner), DelegationID: new("dlg-" + suffix),
		}
		delegated.ApplyScope(domain.NewProjectAssignmentScope())
		require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), delegated))
		directSources := []domain.ProjectAdminSourceRecord{{GrantID: directGrant}, {GrantID: delegated.ID}}
		slices.SortFunc(directSources, func(a, b domain.ProjectAdminSourceRecord) int { return strings.Compare(a.GrantID, b.GrantID) })
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
			{direct, directSources},
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

		byUserID := database.OrderBy[domain.ProjectAdminField]{
			Columns:   []database.Column[domain.ProjectAdminField]{database.Col(domain.ProjectAdminFieldUserID)},
			Direction: database.OrderAsc,
		}
		list := func(viewer string, limit uint32, order database.OrderBy[domain.ProjectAdminField], cursor []byte) *database.ListResult[*domain.ProjectAdminRecord] {
			t.Helper()
			got, err := d.stmts.ListProjectAdmins(t.Context(), projectID, viewer, database.Page[domain.ProjectAdminField]{
				Limit: limit, OrderBy: order, Cursor: cursor,
			})
			require.NoError(t, err)
			return got
		}

		want := seenBy()
		got := list("", 100, byUserID, nil)
		assert.Equal(t, want, got.Items,
			"by user id, sources owning team, team grants and user grants; deleted, viewer, editor, expired, revoked, foreign and departed left out")
		assert.Empty(t, got.NextCursor)
		assert.NotContains(t, adminUserIDs(got.Items), teamMember, "a person only in a team the viewer is not in is left out")

		assert.Equal(t, seenBy(owningTeam, opsTeam), list(owner, 100, byUserID, nil).Items, "the owner is in both teams")
		assert.Equal(t, seenBy(opsTeam), list(teamMember, 100, byUserID, nil).Items, "a member of ops sees ops, not the owning team")
		assert.Equal(t, want, list(left, 100, byUserID, nil).Items, "a member who left sees no team")

		// Paging: people, not rows, fill a page, even someone with two admin
		// rows, and the cursor resumes after the last person.
		first := list("", 2, byUserID, nil)
		assert.Equal(t, want[:2], first.Items, "the limit counts people, and keeps all of their sources")
		require.NotEmpty(t, first.NextCursor, "a third person means another page")
		second := list("", 2, byUserID, first.NextCursor)
		assert.Equal(t, want[2:], second.Items)
		assert.Empty(t, second.NextCursor)

		byUserIDDesc := byUserID
		byUserIDDesc.Direction = database.OrderDesc
		reversed := slices.Clone(want)
		slices.Reverse(reversed)
		firstDesc := list("", 2, byUserIDDesc, nil)
		assert.Equal(t, reversed[:2], firstDesc.Items, "descending order pages from the other end")
		assert.Equal(t, reversed[2:], list("", 2, byUserIDDesc, firstDesc.NextCursor).Items)

		ownerFirst := list(owner, 1, byUserID, nil)
		assert.Equal(t, seenBy(owningTeam, opsTeam)[:1], ownerFirst.Items)
		assert.Equal(t, seenBy(owningTeam, opsTeam)[1:2], list(owner, 1, byUserID, ownerFirst.NextCursor).Items,
			"a viewer off the page still decides who is listed")

		_, err := d.stmts.ListProjectAdmins(t.Context(), projectID, "", database.Page[domain.ProjectAdminField]{
			Limit: 2, OrderBy: byUserID, Cursor: pagination.New(byUserID, []any{"user\x00"}).Marshal(),
		})
		assert.ErrorIs(t, err, database.ErrInvalidCursor(), "a NUL byte in the cursor is an invalid cursor, not a database error")
		_, err = d.stmts.ListProjectAdmins(t.Context(), projectID, "", database.Page[domain.ProjectAdminField]{
			Limit: 2, OrderBy: byUserIDDesc, Cursor: first.NextCursor,
		})
		assert.ErrorIs(t, err, database.ErrCursorOrderMismatch())

		none, err := d.stmts.ListProjectAdmins(t.Context(), otherProjectID+"-missing", "", database.Page[domain.ProjectAdminField]{Limit: 100, OrderBy: byUserID})
		require.NoError(t, err)
		assert.Empty(t, none.Items)

		// The list must say what the authorization check says: everyone the
		// owner sees (both admin teams) is exactly who CheckAuthz allows admin
		// on the project. The deleted user is left out of the comparison: the
		// check reads only assignments, and a deleted user cannot sign in.
		catalogID, err := d.stmts.ActiveSystemCatalogID(t.Context())
		require.NoError(t, err)
		var allowed []string
		for _, userID := range []string{owner, teamMember, direct, expiring, viewer, expired, revoked, elsewhere, left} {
			ok, _, err := d.stmts.CheckAuthz(t.Context(), domain.AuthzCheckParams{
				CatalogID: catalogID, ProjectID: projectID, PrincipalHomeProjectID: home,
				PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: userID,
				ObjectType: "project", Relation: "admin",
			})
			require.NoError(t, err)
			if ok {
				allowed = append(allowed, userID)
			}
		}
		assert.ElementsMatch(t, allowed, adminUserIDs(list(owner, 100, byUserID, nil).Items),
			"the list follows the authorization check")
	})
}

func adminUserIDs(records []*domain.ProjectAdminRecord) []string {
	ids := make([]string, 0, len(records))
	for _, record := range records {
		ids = append(ids, record.UserID)
	}
	return ids
}
