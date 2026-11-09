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

// ListProjectMembers reads who has a role on a project the way the
// authorization check decides it: active members of the owning team and of
// granted teams, and existing users granted a role, through unrevoked,
// unexpired grants on that project only, each with their strongest role.
func TestAuthzAssignmentStatements_ListProjectMembers(t *testing.T) {
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
		reader := user("k")

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
		directSources := []domain.ProjectMemberSourceRecord{{GrantID: directGrant}, {GrantID: delegated.ID}}
		slices.SortFunc(directSources, func(a, b domain.ProjectMemberSourceRecord) int { return strings.Compare(a.GrantID, b.GrantID) })
		expiringGrant := grant(projectID, domain.AuthzPrincipalTypeUser, expiring, "admin", &future)
		grant(projectID, domain.AuthzPrincipalTypeUser, deleted, "admin", nil)
		grant(projectID, domain.AuthzPrincipalTypeUser, viewer, "viewer", nil)
		viewerEditorGrant := grant(projectID, domain.AuthzPrincipalTypeUser, viewer, "editor", nil)
		readerGrant := grant(projectID, domain.AuthzPrincipalTypeUser, reader, "viewer", nil)
		// A viewer grant to ops does not change its members' admin role.
		grant(projectID, domain.AuthzPrincipalTypeTeam, opsTeam, "viewer", nil)
		grant(projectID, domain.AuthzPrincipalTypeUser, expired, "admin", &past)
		require.NoError(t, d.stmts.RevokeAuthzAssignment(t.Context(), projectID,
			grant(projectID, domain.AuthzPrincipalTypeUser, revoked, "admin", nil)))
		grant(otherProjectID, domain.AuthzPrincipalTypeUser, elsewhere, "admin", nil)
		require.NoError(t, d.stmts.DeleteUserByID(t.Context(), home, deleted))
		require.NoError(t, d.stmts.DeleteAuthzMembershipEdges(t.Context(), edgeFilter(home, domain.AuthzSetTypeTeam, opsTeam, domain.AuthzMemberTypeUser, left)))

		type person struct {
			userID   string
			relation string
			sources  []domain.ProjectMemberSourceRecord
		}
		all := []person{
			{owner, "admin", []domain.ProjectMemberSourceRecord{
				{OwningTeam: true, TeamID: owningTeam, TeamName: "owners"},
				{GrantID: opsGrant, TeamID: opsTeam, TeamName: "ops"},
				{GrantID: ownerGrant},
			}},
			{teamMember, "admin", []domain.ProjectMemberSourceRecord{{GrantID: opsGrant, TeamID: opsTeam, TeamName: "ops"}}},
			{direct, "admin", directSources},
			{expiring, "admin", []domain.ProjectMemberSourceRecord{{GrantID: expiringGrant}}},
			{viewer, "editor", []domain.ProjectMemberSourceRecord{{GrantID: viewerEditorGrant}}},
			{reader, "viewer", []domain.ProjectMemberSourceRecord{{GrantID: readerGrant}}},
		}
		// atLeast is the people with at least minRelation, with every source of
		// their role.
		atLeast := func(minRelation string) []*domain.ProjectMemberRecord {
			out := make([]*domain.ProjectMemberRecord, 0, len(all))
			for _, p := range all {
				if slices.Contains(domain.ProjectRolesAtLeast(minRelation), p.relation) {
					out = append(out, &domain.ProjectMemberRecord{UserID: p.userID, HomeProjectID: home, Relation: p.relation, Sources: p.sources})
				}
			}
			return out
		}

		byUserID := database.OrderBy[domain.ProjectMemberField]{
			Columns:   []database.Column[domain.ProjectMemberField]{database.Col(domain.ProjectMemberFieldUserID)},
			Direction: database.OrderAsc,
		}
		listAtLeast := func(minRelation string, limit uint32, order database.OrderBy[domain.ProjectMemberField], cursor []byte) *database.ListResult[*domain.ProjectMemberRecord] {
			t.Helper()
			got, err := d.stmts.ListProjectMembers(t.Context(), projectID, minRelation, database.Page[domain.ProjectMemberField]{
				Limit: limit, OrderBy: order, Cursor: cursor,
			})
			require.NoError(t, err)
			return got
		}
		list := func(limit uint32, order database.OrderBy[domain.ProjectMemberField], cursor []byte) *database.ListResult[*domain.ProjectMemberRecord] {
			t.Helper()
			return listAtLeast("admin", limit, order, cursor)
		}

		want := atLeast("admin")
		got := list(100, byUserID, nil)
		assert.Equal(t, want, got.Items,
			"by user id, sources owning team, team grants and user grants, every team named; deleted, viewer, editor, expired, revoked, foreign and departed left out")
		assert.NotContains(t, memberUserIDs(got.Items), viewer, "an editor is not an admin")
		assert.Empty(t, got.NextCursor)

		// Paging: people, not rows, fill a page, even someone with two admin
		// rows, and the cursor resumes after the last person.
		first := list(2, byUserID, nil)
		assert.Equal(t, want[:2], first.Items, "the limit counts people, and keeps all of their sources")
		require.NotEmpty(t, first.NextCursor, "a third person means another page")
		second := list(2, byUserID, first.NextCursor)
		assert.Equal(t, want[2:], second.Items)
		assert.Empty(t, second.NextCursor)

		byUserIDDesc := byUserID
		byUserIDDesc.Direction = database.OrderDesc
		reversed := slices.Clone(want)
		slices.Reverse(reversed)
		firstDesc := list(2, byUserIDDesc, nil)
		assert.Equal(t, reversed[:2], firstDesc.Items, "descending order pages from the other end")
		assert.Equal(t, reversed[2:], list(2, byUserIDDesc, firstDesc.NextCursor).Items)

		// Every role: the strongest of each person, with only its sources.
		assert.Equal(t, atLeast(""), listAtLeast("", 100, byUserID, nil).Items,
			"the editor with a viewer grant is an editor, the ops members keep admin over ops' viewer grant")
		assert.Equal(t, atLeast("viewer"), listAtLeast("viewer", 100, byUserID, nil).Items, "viewer means everyone")
		assert.Equal(t, atLeast("editor"), listAtLeast("editor", 100, byUserID, nil).Items, "editor leaves out the viewer")
		assert.Empty(t, listAtLeast("team", 100, byUserID, nil).Items, "a relation that is not a project role matches nobody")
		everyone := listAtLeast("", 4, byUserID, nil)
		assert.Equal(t, atLeast("")[:4], everyone.Items)
		assert.Equal(t, atLeast("")[4:], listAtLeast("", 4, byUserID, everyone.NextCursor).Items, "the weaker roles page like the admins")

		_, err := d.stmts.ListProjectMembers(t.Context(), projectID, "admin", database.Page[domain.ProjectMemberField]{
			Limit: 2, OrderBy: byUserID, Cursor: pagination.New(byUserID, []any{"user\x00"}).Marshal(),
		})
		assert.ErrorIs(t, err, database.ErrInvalidCursor(), "a NUL byte in the cursor is an invalid cursor, not a database error")
		_, err = d.stmts.ListProjectMembers(t.Context(), projectID, "admin", database.Page[domain.ProjectMemberField]{
			Limit: 2, OrderBy: byUserIDDesc, Cursor: first.NextCursor,
		})
		assert.ErrorIs(t, err, database.ErrCursorOrderMismatch())

		none, err := d.stmts.ListProjectMembers(t.Context(), otherProjectID+"-missing", "", database.Page[domain.ProjectMemberField]{Limit: 100, OrderBy: byUserID})
		require.NoError(t, err)
		assert.Empty(t, none.Items)

		// The list must say what the authorization check says: the admins are
		// exactly who CheckAuthz allows admin on the project. The deleted user is left out of the comparison: the
		// check reads only assignments, and a deleted user cannot sign in.
		catalogID, err := d.stmts.ActiveSystemCatalogID(t.Context())
		require.NoError(t, err)
		var allowed []string
		for _, userID := range []string{owner, teamMember, direct, expiring, viewer, expired, revoked, elsewhere, left, reader} {
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
		assert.ElementsMatch(t, allowed, memberUserIDs(list(100, byUserID, nil).Items),
			"the list follows the authorization check")
	})
}

func memberUserIDs(records []*domain.ProjectMemberRecord) []string {
	ids := make([]string, 0, len(records))
	for _, record := range records {
		ids = append(ids, record.UserID)
	}
	return ids
}
