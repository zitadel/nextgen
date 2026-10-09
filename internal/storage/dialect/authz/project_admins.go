package authz

import (
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

// ProjectAdminSchema binds the one field a project admins list orders and
// pages by: user_id, a column of the query's result rather than a table.
var ProjectAdminSchema = database.NewSchema(map[domain.ProjectAdminField]database.FieldBinding[domain.ProjectAdminRecord]{
	domain.ProjectAdminFieldUserID: {
		SQLName:  "user_id",
		Accessor: func(r *domain.ProjectAdminRecord) any { return r.UserID },
		Coerce:   database.CoerceString,
		Computed: true,
	},
})

// ProjectAdminsCursor is where a project admins page resumes: after (or, in
// descending order, before) the user id of the previous page's last person.
type ProjectAdminsCursor struct {
	UserID string
	Set    bool
}

// ProjectAdminsCursorFrom decodes and checks the page's cursor the way the
// dialects' keyset filters do: it must match the page's order, and its value
// must be a user id. A NUL byte is refused too: Postgres rejects it in a text
// parameter, which would otherwise surface as an internal error.
func ProjectAdminsCursorFrom(page database.Page[domain.ProjectAdminField]) (ProjectAdminsCursor, error) {
	if err := ProjectAdminSchema.EnsureOrderable(page.OrderBy); err != nil {
		return ProjectAdminsCursor{}, err
	}
	if len(page.Cursor) == 0 {
		return ProjectAdminsCursor{}, nil
	}
	cursor, err := pagination.CursorFromToken[domain.ProjectAdminField](page.Cursor)
	if err != nil {
		return ProjectAdminsCursor{}, database.ErrInvalidCursor()
	}
	if !cursor.MatchesOrderBy(page.OrderBy) {
		return ProjectAdminsCursor{}, database.ErrCursorOrderMismatch()
	}
	values, err := ProjectAdminSchema.CoerceCursorValues(cursor.Columns, cursor.Values)
	if err != nil {
		return ProjectAdminsCursor{}, database.ErrInvalidCursor().WithParent(err)
	}
	userID, _ := values[0].(string)
	if userID == "" || strings.ContainsRune(userID, 0) {
		return ProjectAdminsCursor{}, database.ErrInvalidCursor()
	}
	return ProjectAdminsCursor{UserID: userID, Set: true}, nil
}

// WriteProjectAdminSources emits the query behind ListProjectAdmins: every
// way the first limit people (0 for no limit) administer a project, among
// those viewerUserID may see, in user id order (descending when desc) from the
// cursor. It selects user_id, home_project_id, source_rank (0 owning team, 1
// team grant, 2 user grant), grant_id, team_id and team_name.
//
// The viewer sees a person who holds an admin grant of their own, or who is a
// member of one of the project's admin teams that the viewer is also an
// active member of; anyone else is left out. team_name is only selected for
// those teams.
//
// It follows the authorization check: team members are read from the
// membership edges the resolver expands, with the resolver's own edge match,
// grant expiry is compared to the dialect clock, and a grant to a user only
// counts while the user exists.
//
// It picks the page's people before reading everyone's sources: the
// candidates are the members of the viewer's own admin teams and the users
// granted directly, and sources are then read only for the page's people.
// How much of a large team is read for the candidates is up to the dialect's
// planner.
func WriteProjectAdminSources(w ArgWriter, env Env, projectID, viewerUserID string, cursor ProjectAdminsCursor, desc bool, limit uint32) {
	compare, direction := " > ", " ASC"
	if desc {
		compare, direction = " < ", " DESC"
	}
	writeAfter := func(column string) {
		if cursor.Set {
			w.WriteString(` AND ` + column + compare)
			w.WriteArg(cursor.UserID)
		}
	}
	writeLimit := func() {
		if limit > 0 {
			w.WriteString(`
  LIMIT `)
			w.WriteArg(int64(limit))
		}
	}

	w.WriteString(`
WITH owning AS (
  `)
	WriteActiveOwningTeamID(w, env, func(w ArgWriter) { w.WriteArg(projectID) })
	w.WriteString(`
),
admin_grants AS (
  SELECT a.id, a.principal_type, a.principal_id
  FROM `)
	writeTable(w, env, "authz_assignments")
	w.WriteString(` a
  WHERE a.project_id = `)
	w.WriteArg(projectID)
	w.WriteString(` AND `)
	w.WriteString(ManagedGrantListConjunct)
	w.WriteString(` AND a.relation = 'admin' AND `)
	writeExpiresActive(w, env, "a")
	w.WriteString(`
),
admin_teams AS (
  SELECT o.principal_id AS team_id, '' AS grant_id, 0 AS source_rank
  FROM owning o
  UNION ALL
  SELECT g.principal_id, g.id, 1
  FROM admin_grants g
  WHERE g.principal_type = 'team'
),
team_homes AS (
  SELECT t.team_id, t.grant_id, t.source_rank, r.project_id AS home_project_id
  FROM admin_teams t
  JOIN `)
	writeTable(w, env, "resource_scope_index")
	w.WriteString(` r ON r.resource_id = t.team_id AND r.resource_kind = `)
	w.WriteArg(string(domain.ResourceKindTeam))
	w.WriteString(`
),
direct_grants AS (
  SELECT u.id AS user_id, u.project_id AS home_project_id, g.id AS grant_id
  FROM admin_grants g
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
viewer_teams AS (
  SELECT DISTINCT th.team_id
  FROM team_homes th
  JOIN `)
	writeTable(w, env, "authz_membership_edges")
	w.WriteString(` e ON `)
	writeMembershipEdgeMatchIn(w, "th.home_project_id", "", "th.team_id", "", "", "")
	// Written out rather than passed as the member: an empty viewer, a caller
	// that is not a user, must match nobody, not every member.
	w.WriteString(`
          AND e.member_id = `)
	w.WriteArg(viewerUserID)
	w.WriteString(`
),
people AS (
  SELECT DISTINCT user_id
  FROM (
    SELECT e.member_id AS user_id
    FROM team_homes th
    JOIN viewer_teams vt ON vt.team_id = th.team_id
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
  SELECT p.user_id, th.home_project_id, th.source_rank, th.grant_id, th.team_id
  FROM people p
  CROSS JOIN team_homes th
  JOIN `)
	writeTable(w, env, "authz_membership_edges")
	w.WriteString(` e ON `)
	writeMembershipEdgeMatchIn(w, "th.home_project_id", "", "th.team_id", "", "p.user_id", "")
	w.WriteString(`
  UNION ALL
  SELECT d.user_id, d.home_project_id, 2, d.grant_id, ''
  FROM direct_grants d
  JOIN people p ON p.user_id = d.user_id
)
SELECT s.user_id, s.home_project_id, s.source_rank, s.grant_id, s.team_id, tm.name
FROM sources s
LEFT JOIN viewer_teams vt ON vt.team_id = s.team_id
LEFT JOIN `)
	writeTable(w, env, "teams")
	w.WriteString(` tm ON vt.team_id IS NOT NULL AND tm.project_id = s.home_project_id AND tm.id = s.team_id
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

// ProjectAdminSourceRow is one row of WriteProjectAdminSources' result.
type ProjectAdminSourceRow struct {
	UserID        string
	HomeProjectID string
	SourceRank    int64
	GrantID       string
	TeamID        string
	TeamName      string
}

// GroupProjectAdminSourcesByUser folds the rows into one record per person. The query
// orders rows by user id, so a person's rows are adjacent: a new user id
// starts the next person.
func GroupProjectAdminSourcesByUser(rows []ProjectAdminSourceRow) []*domain.ProjectAdminRecord {
	var admins []*domain.ProjectAdminRecord
	for _, row := range rows {
		if len(admins) == 0 || admins[len(admins)-1].UserID != row.UserID {
			admins = append(admins, &domain.ProjectAdminRecord{UserID: row.UserID, HomeProjectID: row.HomeProjectID})
		}
		admin := admins[len(admins)-1]
		admin.Sources = append(admin.Sources, domain.ProjectAdminSourceRecord{
			OwningTeam: row.SourceRank == 0,
			GrantID:    row.GrantID,
			TeamID:     row.TeamID,
			TeamName:   row.TeamName,
		})
	}
	return admins
}
