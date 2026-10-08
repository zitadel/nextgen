package authz

import "github.com/zitadel/nextgen/internal/domain"

// WriteProjectAdminSources emits the query behind ListProjectAdmins: every
// way the first limit people with a user id after afterUserID, by user id,
// administer a project, among those viewerUserID may see. It selects user_id,
// home_project_id, source_rank (0 owning team, 1 team grant, 2 user grant),
// grant_id, team_id and team_name.
//
// The viewer sees a person who holds a grant directly, or who is in a team the
// viewer is an active member of; anyone else is left out. team_name is only
// selected for the viewer's own teams.
//
// It follows the authorization check: team members are read from the
// membership edges the resolver expands, grant expiry is compared to the
// dialect clock, and a grant to a user only counts while the user exists.
//
// It picks the page's people before reading everyone's sources: the
// candidates are the members of the viewer's own admin teams and the users
// granted directly, so a team the viewer is not in is never expanded, however
// large. Sources are then read only for the page's people. Principals are
// located through resource_scope_index, so every lookup after it is by
// primary key.
func WriteProjectAdminSources(w ArgWriter, env Env, projectID, afterUserID, viewerUserID string, limit uint32) {
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
direct AS (
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
  WHERE g.principal_type = 'user' AND g.principal_id > `)
	w.WriteArg(afterUserID)
	// Anyone on the page with a grant of their own ranks among the first
	// limit such users, so no more are read.
	w.WriteString(`
  ORDER BY u.id
  LIMIT `)
	w.WriteArg(int64(limit))
	w.WriteString(`
),
viewer_teams AS (
  SELECT DISTINCT th.team_id
  FROM team_homes th
  JOIN `)
	writeTable(w, env, "authz_membership_edges")
	w.WriteString(` e ON e.project_id = th.home_project_id AND e.set_type = 'team' AND e.set_id = th.team_id
    AND e.member_type = 'user' AND e.member_id = `)
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
	w.WriteString(` e ON e.project_id = th.home_project_id AND e.set_type = 'team' AND e.set_id = th.team_id
      AND e.member_type = 'user'
    WHERE e.member_id > `)
	w.WriteArg(afterUserID)
	w.WriteString(`
    UNION ALL
    SELECT d.user_id
    FROM direct d
  ) candidates
  ORDER BY user_id
  LIMIT `)
	w.WriteArg(int64(limit))
	w.WriteString(`
),
sources AS (
  SELECT p.user_id, th.home_project_id, th.source_rank, th.grant_id, th.team_id
  FROM people p
  CROSS JOIN team_homes th
  JOIN `)
	writeTable(w, env, "authz_membership_edges")
	w.WriteString(` e ON e.project_id = th.home_project_id AND e.set_type = 'team' AND e.set_id = th.team_id
    AND e.member_type = 'user' AND e.member_id = p.user_id
  UNION ALL
  SELECT d.user_id, d.home_project_id, 2, d.grant_id, ''
  FROM direct d
  JOIN people p ON p.user_id = d.user_id
)
SELECT s.user_id, s.home_project_id, s.source_rank, s.grant_id, s.team_id, tm.name
FROM sources s
LEFT JOIN viewer_teams vt ON vt.team_id = s.team_id
LEFT JOIN `)
	writeTable(w, env, "teams")
	w.WriteString(` tm ON vt.team_id IS NOT NULL AND tm.project_id = s.home_project_id AND tm.id = s.team_id
ORDER BY s.user_id, s.source_rank, s.grant_id`)
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
