package authz

import "github.com/zitadel/nextgen/internal/domain"

// WriteProjectsOwnedThroughMember emits the projects, ordered by project id,
// whose owning team has userID as an active member. WriteProjectsLosingLastOwner
// is the same query restricted to projects where userID is the owning team's
// only active member.
//
// An active member is a membership edge in the team's home project: removing
// a membership or deactivating the user drops the edge. The active
// owning-team assignment (relation team, not revoked) names the team. Admin
// grants, platform operators and the project secret are not owners. A project
// whose owning team has no active member is not returned.
func WriteProjectsOwnedThroughMember(w ArgWriter, env Env, userID string) {
	writeOwnerProjects(w, env, userID, false)
}

// WriteProjectsLosingLastOwner emits the projects WriteProjectsOwnedThroughMember
// would return where no other active member of the owning team remains.
func WriteProjectsLosingLastOwner(w ArgWriter, env Env, userID string) {
	writeOwnerProjects(w, env, userID, true)
}

func writeOwnerProjects(w ArgWriter, env Env, userID string, losing bool) {
	w.WriteString(`
WITH owners AS (
  SELECT o.project_id, e.member_id AS user_id
  FROM `)
	writeTable(w, env, "authz_assignments")
	w.WriteString(` o
  JOIN `)
	writeTable(w, env, "resource_scope_index")
	w.WriteString(` r ON r.resource_id = o.principal_id AND r.resource_kind = `)
	w.WriteArg(string(domain.ResourceKindTeam))
	w.WriteString(`
  JOIN `)
	writeTable(w, env, "authz_membership_edges")
	w.WriteString(` e ON `)
	writeMembershipEdgeMatchIn(w, "r.project_id", "", "o.principal_id", "", "", "")
	w.WriteString(`
  WHERE o.object_type = 'project' AND o.relation = 'team' AND o.revoked_at IS NULL
)
SELECT s.project_id
FROM owners s
WHERE s.user_id = `)
	w.WriteArg(userID)
	if losing {
		w.WriteString(`
  AND NOT EXISTS (
    SELECT 1 FROM owners kept
    WHERE kept.project_id = s.project_id AND kept.user_id <> `)
		w.WriteArg(userID)
		w.WriteString(`
  )`)
	}
	w.WriteString(`
GROUP BY s.project_id
ORDER BY s.project_id`)
}
