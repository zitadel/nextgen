package authz

import "github.com/zitadel/nextgen/internal/domain"

// WriteProjectsTouchedByAdminRemoval emits the projects, ordered by project
// id, where removal matches someone who can administer the project now.
// WriteProjectsLosingLastAdmin is the same query restricted to projects where
// nobody would remain. Both count a person once however many sources they
// have, and neither applies a viewer filter or a page limit.
//
// The sources are the ones ListProjectAdmins reads: an active member of the
// owning team, an existing user with an unexpired admin grant, or an active
// member of a team with an unexpired admin grant. Viewer and editor grants,
// expired and revoked grants, platform operators, and the project secret are
// not sources. A project that already has nobody in the set is not returned.
//
// An empty removal field matches nothing. Owning-team sources store an empty
// grant id and grants to a user store an empty team id, so excluding one does
// not drop the other.
func WriteProjectsTouchedByAdminRemoval(w ArgWriter, env Env, removal domain.AdminRemoval) {
	writeAdminRemovalProjects(w, env, removal, false)
}

// WriteProjectsLosingLastAdmin emits the projects WriteProjectsTouchedByAdminRemoval
// would return where no source that removal does not match remains.
func WriteProjectsLosingLastAdmin(w ArgWriter, env Env, removal domain.AdminRemoval) {
	writeAdminRemovalProjects(w, env, removal, true)
}

func writeAdminRemovalProjects(w ArgWriter, env Env, removal domain.AdminRemoval, losing bool) {
	w.WriteString(`
WITH owning AS (
  SELECT a.project_id, a.principal_id AS team_id
  FROM `)
	writeTable(w, env, "authz_assignments")
	w.WriteString(` a
  WHERE a.object_type = 'project' AND a.relation = 'team' AND a.revoked_at IS NULL
),
admin_grants AS (
  SELECT a.project_id, a.id, a.principal_type, a.principal_id
  FROM `)
	writeTable(w, env, "authz_assignments")
	w.WriteString(` a
  WHERE `)
	w.WriteString(ManagedGrantListConjunct)
	w.WriteString(` AND a.relation = 'admin' AND `)
	writeExpiresActive(w, env, "a")
	w.WriteString(`
),
admin_sources AS (
  SELECT o.project_id, e.member_id AS user_id, '' AS grant_id, o.team_id AS team_id
  FROM owning o
  JOIN `)
	writeTable(w, env, "resource_scope_index")
	w.WriteString(` r ON r.resource_id = o.team_id AND r.resource_kind = `)
	w.WriteArg(string(domain.ResourceKindTeam))
	w.WriteString(`
  JOIN `)
	writeTable(w, env, "authz_membership_edges")
	w.WriteString(` e ON `)
	writeMembershipEdgeMatchIn(w, "r.project_id", "", "o.team_id", "", "", "")
	w.WriteString(`
  UNION ALL
  SELECT g.project_id, e.member_id, g.id, g.principal_id
  FROM admin_grants g
  JOIN `)
	writeTable(w, env, "resource_scope_index")
	w.WriteString(` r ON r.resource_id = g.principal_id AND r.resource_kind = `)
	w.WriteArg(string(domain.ResourceKindTeam))
	w.WriteString(`
  JOIN `)
	writeTable(w, env, "authz_membership_edges")
	w.WriteString(` e ON `)
	writeMembershipEdgeMatchIn(w, "r.project_id", "", "g.principal_id", "", "", "")
	w.WriteString(`
  WHERE g.principal_type = 'team'
  UNION ALL
  SELECT g.project_id, u.id, g.id, ''
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
)
SELECT s.project_id
FROM admin_sources s
WHERE `)
	writeAdminRemovalMatch(w, "s", removal)
	if losing {
		w.WriteString(`
  AND NOT EXISTS (
    SELECT 1 FROM admin_sources kept
    WHERE kept.project_id = s.project_id
      AND NOT `)
		writeAdminRemovalMatch(w, "kept", removal)
		w.WriteString(`
  )`)
	}
	w.WriteString(`
GROUP BY s.project_id
ORDER BY s.project_id`)
}

// writeAdminRemovalMatch is true for a source removal drops. Each id is
// compared only when it is non-empty, so an unset field matches nothing.
func writeAdminRemovalMatch(w ArgWriter, alias string, removal domain.AdminRemoval) {
	w.WriteString(`((`)
	w.WriteString(alias)
	w.WriteString(`.user_id = `)
	w.WriteArg(removal.UserID)
	w.WriteString(` AND `)
	w.WriteArg(removal.UserID)
	w.WriteString(` <> '') OR (`)
	w.WriteString(alias)
	w.WriteString(`.grant_id = `)
	w.WriteArg(removal.GrantID)
	w.WriteString(` AND `)
	w.WriteArg(removal.GrantID)
	w.WriteString(` <> '') OR (`)
	w.WriteString(alias)
	w.WriteString(`.team_id = `)
	w.WriteArg(removal.TeamID)
	w.WriteString(` AND `)
	w.WriteArg(removal.TeamID)
	w.WriteString(` <> ''))`)
}
