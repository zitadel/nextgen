package authz

import "github.com/zitadel/nextgen/internal/domain"

// WriteProjectAdminSources emits the query behind ListProjectAdmins: every
// way the first limit people with a user id after afterUserID, by user id,
// administer a project. It selects user_id, home_project_id, source_rank
// (0 owning team, 1 team grant, 2 user grant), grant_id, team_id, visible and
// team_name.
//
// visible marks what viewerUserID may see: a grant to the person, or a team the
// viewer is an active member of. team_name is only selected for those.
//
// It follows the authorization check: team members are read from the
// membership edges the resolver expands, grant expiry is compared to the
// dialect clock, and a grant to a user only counts while the user exists.
// Principals are located through resource_scope_index, so every lookup after
// it is by primary key.
func WriteProjectAdminSources(w ArgWriter, env Env, projectID, afterUserID, viewerUserID string, limit uint32) {
	w.WriteString(`
WITH owning AS (
  SELECT principal_id AS team_id
  FROM `)
	writeTable(w, env, "authz_assignments")
	w.WriteString(`
  WHERE project_id = `)
	w.WriteArg(projectID)
	w.WriteString(` AND object_type = 'project' AND relation = 'team' AND revoked_at IS NULL
  ORDER BY created_at, id
  LIMIT 1
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
  SELECT o.team_id, '' AS grant_id, 0 AS source_rank
  FROM owning o
  UNION ALL
  SELECT g.principal_id, g.id, 1
  FROM admin_grants g
  WHERE g.principal_type = 'team'
),
sources AS (
  SELECT e.member_id AS user_id, e.project_id AS home_project_id, t.source_rank, t.grant_id, t.team_id
  FROM admin_teams t
  JOIN `)
	writeTable(w, env, "resource_scope_index")
	w.WriteString(` r ON r.resource_id = t.team_id AND r.resource_kind = `)
	w.WriteArg(string(domain.ResourceKindTeam))
	w.WriteString(`
  JOIN `)
	writeTable(w, env, "authz_membership_edges")
	w.WriteString(` e ON e.project_id = r.project_id AND e.set_type = 'team' AND e.set_id = t.team_id AND e.member_type = 'user'
  UNION ALL
  SELECT u.id, u.project_id, 2, g.id, ''
  FROM admin_grants g
  JOIN `)
	writeTable(w, env, "resource_scope_index")
	w.WriteString(` r ON r.resource_id = g.principal_id AND r.resource_kind = `)
	w.WriteArg(string(domain.ResourceKindUser))
	w.WriteString(`
  JOIN `)
	writeTable(w, env, "users")
	w.WriteString(` u ON u.project_id = r.project_id AND u.id = g.principal_id
  WHERE g.principal_type = 'user'
),
people AS (
  SELECT DISTINCT user_id
  FROM sources
  WHERE user_id > `)
	w.WriteArg(afterUserID)
	w.WriteString(`
  ORDER BY user_id
  LIMIT `)
	w.WriteArg(int64(limit))
	w.WriteString(`
),
viewer_teams AS (
  SELECT DISTINCT team_id
  FROM sources
  WHERE user_id = `)
	w.WriteArg(viewerUserID)
	w.WriteString(` AND team_id <> ''
)
SELECT s.user_id, s.home_project_id, s.source_rank, s.grant_id, s.team_id,
  (s.team_id = '' OR vt.team_id IS NOT NULL) AS visible, tm.name
FROM sources s
LEFT JOIN viewer_teams vt ON vt.team_id = s.team_id
LEFT JOIN `)
	writeTable(w, env, "teams")
	w.WriteString(` tm ON vt.team_id IS NOT NULL AND tm.project_id = s.home_project_id AND tm.id = s.team_id
WHERE s.user_id IN (SELECT user_id FROM people)
ORDER BY s.user_id, s.source_rank, s.grant_id`)
}

// ProjectAdminSourceRow is one row of WriteProjectAdminSources' result.
type ProjectAdminSourceRow struct {
	UserID        string
	HomeProjectID string
	SourceRank    int64
	GrantID       string
	TeamID        string
	Visible       bool
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
		admin.Visible = admin.Visible || row.Visible
		admin.Sources = append(admin.Sources, domain.ProjectAdminSourceRecord{
			OwningTeam: row.SourceRank == 0,
			GrantID:    row.GrantID,
			TeamID:     row.TeamID,
			TeamName:   row.TeamName,
		})
	}
	return admins
}
