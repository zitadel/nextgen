package authz

import (
	"github.com/zitadel/nextgen/internal/domain"
)

// WriteAuthorizedProjectIDs emits a subquery returning the ids of the projects
// the user can act on: those carrying an active project-level grant held by the
// user directly, or by a team the user has a membership edge in inside
// homeProjectID (ADR 053 §3 and §6).
//
// The subquery is principal-first and uncorrelated on purpose. ADR 053 §6 rules
// out "scan every project and Check each row", so a caller lists projects with
// `id IN (this)` and the planner can serve both arms from the principal index on
// authz_assignments and the member index on authz_membership_edges.
//
// ADR 053 §6 puts three kinds of holding in the authorized set, and this emits
// one arm each:
//
//  1. the user holds a project-scoped grant directly;
//  2. a team the user has a membership edge in holds one;
//  3. no grant names the user on the project at all, and authorization comes
//     from the bounded tuple-to-userset path CheckAuthz honors.
//
// The third arm is not a variant of the second. The project carries a tupleset
// row such as project.team held by team T, and the user holds an assignment
// scoped at T that closes to the edge's source relation. Nothing joins the user
// to T through an edge, so arm 2 cannot see it, and an earlier revision of this
// query wrongly collapsed the two.
//
// Every arm comes out of the emitters CheckAuthz uses, so the two read paths
// cannot disagree: writeDirectPrincipal for identity, writeMembershipEdgeMatch
// for team expansion, writeTTUScopeMatch for the tupleset rule.
//
// The team expansions spell membership as IN rather than reusing
// writeUserMembershipInTeam whole: that helper emits a correlated EXISTS, and
// there is no outer row here to correlate to. The shared piece is the edge match
// itself, which is where the home-project rule lives.
//
// No relation filter on any arm: any project-scoped grant makes the project
// reachable for whoever holds it, the owning-team grant (relation 'team')
// included.
func WriteAuthorizedProjectIDs(w ArgWriter, env Env, homeProjectID, userID string) {
	writeActiveProjectGrant(w, env)
	writeDirectPrincipal(w, "a", domain.AuthzPrincipalTypeUser.String(), userID)

	// UNION ALL, not UNION: SQLite rejects UNION DISTINCT and Spanner rejects a
	// bare UNION, and the caller's IN turns duplicates into one row anyway.
	w.WriteString(`
UNION ALL
`)

	writeActiveProjectGrant(w, env)
	w.WriteString(`a.principal_type = 'team'
          AND a.principal_id IN (
        SELECT e.set_id
        FROM `)
	writeTable(w, env, "authz_membership_edges")
	w.WriteString(` e
        WHERE `)
	writeMembershipEdgeMatch(w, homeProjectID, "", "", "", userID)
	w.WriteString(`
    )
UNION ALL
`)

	writeAuthorizedProjectIDsTTU(w, env, homeProjectID, userID)
}

// writeAuthorizedProjectIDsTTU is the third arm: the bounded tuple-to-userset
// path CheckAuthz honors (ADR 053 §6), where no grant names the user on the
// project at all. The project carries a tupleset row (say project.team held by
// team T), and the user holds an assignment that closes to the edge's source
// relation, scoped at T. That is an authorization with no membership edge in it,
// so neither of the first two arms can see it.
//
// It is catalog-driven, not hardcoded to project.team and team.member: the edge
// row says which relation borrows from which tupleset, and authz_relation_closure
// lets any relation that closes to the edge source count, exactly as the resolver
// does. No edge.relation filter: any project relation makes the project
// reachable, which is the same rule the other two arms follow.
//
// The user-side assignment lives in the protected project, not the home project;
// the home project appears only in the membership lookup for a team-held one.
func writeAuthorizedProjectIDsTTU(w ArgWriter, env Env, homeProjectID, userID string) {
	w.WriteString(`SELECT ts.project_id
        FROM `)
	writeTable(w, env, "authz_assignments")
	w.WriteString(` a
        JOIN `)
	writeTable(w, env, "authz_relation_closure")
	w.WriteString(` c
          ON  c.catalog_id       = a.catalog_id
          AND c.from_object_type = a.object_type
          AND c.from_relation    = a.relation
        JOIN `)
	writeTable(w, env, "authz_expression_edges")
	w.WriteString(` edge
          ON  edge.catalog_id         = a.catalog_id
          AND edge.kind               = 'tuple_to_userset'
          AND edge.object_type        = 'project'
          AND edge.source_object_type = c.to_object_type
          AND edge.source_relation    = c.to_relation
        JOIN `)
	writeTable(w, env, "authz_assignments")
	w.WriteString(` ts
          ON  ts.project_id     = a.project_id
          AND ts.catalog_id     = a.catalog_id
          AND ts.object_type    = edge.tupleset_object_type
          AND ts.relation       = edge.tupleset_relation
          AND ts.principal_type = edge.source_object_type
          AND ts.revoked_at IS NULL
          AND `)
	writeExpiresActive(w, env, "ts")
	w.WriteString(`
          AND `)
	writeTTUScopeMatch(w, "a", "ts", "edge")
	w.WriteString(`
        WHERE a.catalog_id = (`)
	WriteActiveSystemCatalogID(w, env)
	w.WriteString(`)
          AND a.revoked_at IS NULL
          AND `)
	writeExpiresActive(w, env, "a")
	w.WriteString(`
          AND (`)
	writeDirectPrincipal(w, "a", domain.AuthzPrincipalTypeUser.String(), userID)
	w.WriteString(`
               OR (a.principal_type = 'team'
              AND a.principal_id IN (
        SELECT e.set_id
        FROM `)
	writeTable(w, env, "authz_membership_edges")
	w.WriteString(` e
        WHERE `)
	writeMembershipEdgeMatch(w, homeProjectID, "", "", "", userID)
	w.WriteString(`
    )))`)
}

// writeActiveProjectGrant opens one arm of WriteAuthorizedProjectIDs with
// everything the two arms share: the SELECT and the conditions that make a row
// an active project-level grant on the active system catalog. It stops on a
// dangling `AND `, so the caller appends only its principal predicate and the
// two arms cannot drift apart.
//
// The catalog pin matters: without it an app-group catalog grant on
// object_type 'project' would surface a project that CheckAuthz, which only ever
// evaluates the active system catalog, refuses to authorize.
func writeActiveProjectGrant(w ArgWriter, env Env) {
	w.WriteString(`SELECT a.project_id
        FROM `)
	writeTable(w, env, "authz_assignments")
	w.WriteString(` a
        WHERE a.object_type = 'project'
          AND a.scope_kind = 'project'
          AND a.revoked_at IS NULL
          AND a.catalog_id = (`)
	WriteActiveSystemCatalogID(w, env)
	w.WriteString(`)
          AND `)
	writeExpiresActive(w, env, "a")
	w.WriteString(`
          AND `)
}
