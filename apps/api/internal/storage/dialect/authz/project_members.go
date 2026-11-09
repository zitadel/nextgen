package authz

import (
	"slices"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

// ProjectMemberSchema binds the one field a project members list orders and
// pages by: user_id, a column of the query's result rather than a table.
var ProjectMemberSchema = database.NewSchema(map[domain.ProjectMemberField]database.FieldBinding[domain.ProjectMemberRecord]{
	domain.ProjectMemberFieldUserID: {
		SQLName:  "user_id",
		Accessor: func(r *domain.ProjectMemberRecord) any { return r.UserID },
		Coerce:   database.CoerceString,
		Computed: true,
	},
})

// ProjectMembersCursorUserID returns the user id a project members page resumes
// after (or, in descending order, before), the previous page's last person, or
// "" on the first page. It decodes and checks the page's cursor the way the
// dialects' keyset filters do: it must match the page's order, and its value
// must be a user id. A NUL byte is refused too: Postgres rejects it in a text
// parameter, which would otherwise surface as an internal error.
func ProjectMembersCursorUserID(page database.Page[domain.ProjectMemberField]) (string, error) {
	if err := ProjectMemberSchema.EnsureOrderable(page.OrderBy); err != nil {
		return "", err
	}
	if len(page.Cursor) == 0 {
		return "", nil
	}
	cursor, err := pagination.CursorFromToken[domain.ProjectMemberField](page.Cursor)
	if err != nil {
		return "", database.ErrInvalidCursor()
	}
	if !cursor.MatchesOrderBy(page.OrderBy) {
		return "", database.ErrCursorOrderMismatch()
	}
	values, err := ProjectMemberSchema.CoerceCursorValues(cursor.Columns, cursor.Values)
	if err != nil {
		return "", database.ErrInvalidCursor().WithParent(err)
	}
	userID, _ := values[0].(string)
	if userID == "" || strings.ContainsRune(userID, 0) {
		return "", database.ErrInvalidCursor()
	}
	return userID, nil
}

// WriteProjectMemberSources emits the query behind ListProjectMembers: every
// way the first limit people (0 for no limit) hold one of relations on a
// project, in user id order (descending when desc) after afterUserID in that
// order ("" for the first page). It selects user_id, home_project_id,
// source_rank (0 owning team, 1 team grant, 2 user grant), grant_id, team_id,
// relation and team_name. The owning team holds admin, so it is a source only
// when relations includes admin. An empty relations matches nobody.
//
// It follows the authorization check: team members are read from the
// membership edges the resolver expands, with the resolver's own edge match,
// grant expiry is compared to the dialect clock, and a grant to a user only
// counts while the user exists.
//
// It picks the page's people before reading everyone's sources: the
// candidates are the members of the granted teams and the users granted
// directly, and sources are then read only for the page's people.
// How much of a large team is read for the candidates is up to the dialect's
// planner.
func WriteProjectMemberSources(w ArgWriter, env Env, projectID string, relations []string, afterUserID string, desc bool, limit uint32) {
	compare, direction := " > ", " ASC"
	if desc {
		compare, direction = " < ", " DESC"
	}
	writeAfter := func(column string) {
		if afterUserID != "" {
			w.WriteString(` AND ` + column + compare)
			w.WriteArg(afterUserID)
		}
	}
	writeLimit := func() {
		if limit > 0 {
			w.WriteString(`
  LIMIT `)
			w.WriteArg(int64(limit))
		}
	}

	writeRelations := func() {
		if len(relations) == 0 {
			w.WriteString(`NULL`)
		}
		for i, relation := range relations {
			if i > 0 {
				w.WriteString(`, `)
			}
			w.WriteArg(relation)
		}
	}

	w.WriteString(`
WITH owning AS (
  `)
	WriteActiveOwningTeamID(w, env, func(w ArgWriter) { w.WriteArg(projectID) })
	w.WriteString(`
),
role_grants AS (
  SELECT a.id, a.principal_type, a.principal_id, a.relation
  FROM `)
	writeTable(w, env, "authz_assignments")
	w.WriteString(` a
  WHERE a.project_id = `)
	w.WriteArg(projectID)
	w.WriteString(` AND `)
	w.WriteString(ManagedGrantListConjunct)
	w.WriteString(` AND a.relation IN (`)
	writeRelations()
	w.WriteString(`) AND `)
	writeExpiresActive(w, env, "a")
	w.WriteString(`
),
member_teams AS (
  SELECT o.principal_id AS team_id, '' AS grant_id, 0 AS source_rank, 'admin' AS relation
  FROM owning o
  WHERE 'admin' IN (`)
	writeRelations()
	w.WriteString(`)
  UNION ALL
  SELECT g.principal_id, g.id, 1, g.relation
  FROM role_grants g
  WHERE g.principal_type = 'team'
),
team_homes AS (
  SELECT t.team_id, t.grant_id, t.source_rank, t.relation, r.project_id AS home_project_id
  FROM member_teams t
  JOIN `)
	writeTable(w, env, "resource_scope_index")
	w.WriteString(` r ON r.resource_id = t.team_id AND r.resource_kind = `)
	w.WriteArg(string(domain.ResourceKindTeam))
	w.WriteString(`
),
direct_grants AS (
  SELECT u.id AS user_id, u.project_id AS home_project_id, g.id AS grant_id, g.relation
  FROM role_grants g
  JOIN `)
	writeTable(w, env, "resource_scope_index")
	w.WriteString(` r ON r.resource_id = g.principal_id AND r.resource_kind = `)
	w.WriteArg(string(domain.ResourceKindUser))
	w.WriteString(`
  JOIN `)
	writeTable(w, env, "users")
	w.WriteString(` u ON u.project_id = r.project_id AND u.id = g.principal_id
  WHERE g.principal_type = 'user'`)
	writeAfter("g.principal_id")
	w.WriteString(`
),
direct_people AS (
  SELECT DISTINCT user_id
  FROM direct_grants
  ORDER BY user_id` + direction)
	// Anyone on the page with a grant of their own ranks among the first
	// limit such people, so no more are taken.
	writeLimit()
	w.WriteString(`
),
people AS (
  SELECT DISTINCT user_id
  FROM (
    SELECT e.member_id AS user_id
    FROM team_homes th
    JOIN `)
	writeTable(w, env, "authz_membership_edges")
	w.WriteString(` e ON `)
	writeMembershipEdgeMatchIn(w, "th.home_project_id", "", "th.team_id", "", "", "")
	w.WriteString(`
    WHERE TRUE`)
	writeAfter("e.member_id")
	w.WriteString(`
    UNION ALL
    SELECT dp.user_id
    FROM direct_people dp
  ) candidates
  ORDER BY user_id` + direction)
	writeLimit()
	w.WriteString(`
),
sources AS (
  SELECT p.user_id, th.home_project_id, th.source_rank, th.grant_id, th.team_id, th.relation
  FROM people p
  CROSS JOIN team_homes th
  JOIN `)
	writeTable(w, env, "authz_membership_edges")
	w.WriteString(` e ON `)
	writeMembershipEdgeMatchIn(w, "th.home_project_id", "", "th.team_id", "", "p.user_id", "")
	w.WriteString(`
  UNION ALL
  SELECT d.user_id, d.home_project_id, 2, d.grant_id, '', d.relation
  FROM direct_grants d
  JOIN people p ON p.user_id = d.user_id
)
SELECT s.user_id, s.home_project_id, s.source_rank, s.grant_id, s.team_id, s.relation, tm.name
FROM sources s
LEFT JOIN `)
	writeTable(w, env, "teams")
	w.WriteString(` tm ON tm.project_id = s.home_project_id AND tm.id = s.team_id
ORDER BY s.user_id` + direction + `, s.source_rank, s.grant_id`)
}

// WriteActiveOwningTeamID emits a SELECT of the principal_id of a project's
// active owning-team grant (ADR 054 §2). projectID writes the project id: an
// argument, or a column of an enclosing query when the SELECT is a subquery. A
// unique index allows at most one active owning-team grant per project, so the
// SELECT yields at most one row.
func WriteActiveOwningTeamID(w ArgWriter, env Env, projectID func(ArgWriter)) {
	w.WriteString(`SELECT principal_id FROM `)
	writeTable(w, env, "authz_assignments")
	w.WriteString(` WHERE project_id = `)
	projectID(w)
	w.WriteString(` AND object_type = 'project' AND relation = 'team' AND revoked_at IS NULL`)
}

// ProjectMemberSourceRow is one row of WriteProjectMemberSources' result.
type ProjectMemberSourceRow struct {
	UserID        string
	HomeProjectID string
	SourceRank    int64
	GrantID       string
	TeamID        string
	Relation      string
	TeamName      string
}

// GroupProjectMemberSourcesByUser folds the rows into one record per person,
// with their strongest role and only the sources that give it. The query
// orders rows by user id, so a person's rows are adjacent: a new user id
// starts the next person.
func GroupProjectMemberSourcesByUser(rows []ProjectMemberSourceRow) []*domain.ProjectMemberRecord {
	var members []*domain.ProjectMemberRecord
	for _, row := range rows {
		if len(members) == 0 || members[len(members)-1].UserID != row.UserID {
			members = append(members, &domain.ProjectMemberRecord{UserID: row.UserID, HomeProjectID: row.HomeProjectID, Relation: row.Relation})
		}
		member := members[len(members)-1]
		switch rank, held := slices.Index(domain.ProjectRoles, row.Relation), slices.Index(domain.ProjectRoles, member.Relation); {
		case rank < held:
			continue
		case rank > held:
			member.Relation, member.Sources = row.Relation, nil
		}
		member.Sources = append(member.Sources, domain.ProjectMemberSourceRecord{
			OwningTeam: row.SourceRank == 0,
			GrantID:    row.GrantID,
			TeamID:     row.TeamID,
			TeamName:   row.TeamName,
		})
	}
	return members
}
