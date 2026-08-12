package authz

import (
	"github.com/zitadel/nextgen/internal/domain"
)

// ArgWriter is satisfied by each dialect's statementCompiler.
type ArgWriter interface {
	WriteString(string)
	WriteArg(any)
}

// Env adapts shared resolver SQL to one dialect (schema prefix + clock).
type Env struct {
	// Schema is table qualifier including trailing dot, or empty (e.g. "zitadel_nextgen.").
	Schema string
	// Now emits the dialect clock compared to expires_at.
	Now func(ArgWriter)
}

func writeTable(w ArgWriter, env Env, name string) {
	w.WriteString(env.Schema)
	w.WriteString(name)
}

func writeExpiresActive(w ArgWriter, env Env, alias string) {
	w.WriteString("(")
	w.WriteString(alias)
	w.WriteString(".expires_at IS NULL OR ")
	w.WriteString(alias)
	w.WriteString(".expires_at > ")
	env.Now(w)
	w.WriteString(")")
}

// WriteActiveSystemCatalogID emits SELECT id for the active system catalog.
func WriteActiveSystemCatalogID(w ArgWriter, env Env) {
	w.WriteString(`
SELECT id
FROM `)
	writeTable(w, env, "authz_catalogs")
	w.WriteString(`
WHERE catalog_kind = `)
	w.WriteArg(domain.AuthzCatalogKindSystem.String())
	w.WriteString(` AND owner_id = `)
	w.WriteArg(domain.SystemCatalogOwnerID)
	w.WriteString(` AND status = `)
	w.WriteArg(domain.AuthzCatalogStatusActive.String())
}

// WriteHasAuthzProjectFoothold emits SELECT (foothold).
func WriteHasAuthzProjectFoothold(w ArgWriter, env Env, projectID string, principalType domain.AuthzPrincipalType, principalID string) {
	w.WriteString("SELECT ")
	writeFoothold(w, env, projectID, principalType, principalID)
}

// WriteCheckAuthz emits SELECT (allowed), (foothold) in one round-trip.
func WriteCheckAuthz(w ArgWriter, env Env, params domain.AuthzCheckParams) {
	w.WriteString("SELECT (")
	writeProjectScopedClosureExists(w, env, params)
	w.WriteString(" OR ")
	writeFullTTUExists(w, env, params)
	w.WriteString("), ")
	writeFoothold(w, env, params.ProjectID, params.PrincipalType, params.PrincipalID)
}

// WriteListAuthzObjectIDs emits SELECT resource_id … ORDER BY resource_id.
func WriteListAuthzObjectIDs(w ArgWriter, env Env, params domain.AuthzListObjectsParams) {
	w.WriteString(`
SELECT r.resource_id
FROM `)
	writeTable(w, env, "resource_scope_index")
	w.WriteString(` r
WHERE `)
	writeListAuthzRSIMatch(w, env, params, "")
	w.WriteString(`
ORDER BY r.resource_id`)
}

// WriteListAuthzExistsPredicate emits EXISTS (SELECT 1 FROM RSI r WHERE
// r.resource_id = <outer> AND …) using the same assignment/closure/TTU
// branches as WriteListAuthzObjectIDs. outerResourceIDExpr is a raw SQL
// column reference (e.g. "zitadel_nextgen.teams.id").
func WriteListAuthzExistsPredicate(w ArgWriter, env Env, outerResourceIDExpr string, params domain.AuthzListObjectsParams) {
	w.WriteString(`EXISTS (
SELECT 1
FROM `)
	writeTable(w, env, "resource_scope_index")
	w.WriteString(` r
WHERE `)
	writeListAuthzRSIMatch(w, env, params, outerResourceIDExpr)
	w.WriteString(`
)`)
}

// writeListAuthzRSIMatch writes the RSI WHERE body shared by list materialization
// and EXISTS injection. When outerResourceIDExpr is non-empty, correlates
// r.resource_id to that outer column.
func writeListAuthzRSIMatch(w ArgWriter, env Env, params domain.AuthzListObjectsParams, outerResourceIDExpr string) {
	if outerResourceIDExpr != "" {
		w.WriteString(`r.resource_id = `)
		w.WriteString(outerResourceIDExpr)
		w.WriteString(`
  AND `)
	}
	w.WriteString(`r.project_id = `)
	w.WriteArg(params.ProjectID)
	w.WriteString(`
  AND r.resource_kind = `)
	w.WriteArg(params.ResourceKind.String())
	w.WriteString(`
  AND (
    `)
	writeProjectScopedClosureExists(w, env, params.AuthzCheckParams)
	w.WriteString(`
    OR `)
	writeFullTTUExists(w, env, params.AuthzCheckParams)
	w.WriteString(`
    OR (
        r.team_id IS NOT NULL
        AND `)
	writeScopedClosureExists(w, env, params.AuthzCheckParams, "team", "r.team_id")
	w.WriteString(`
    )
    OR `)
	writeScopedClosureExists(w, env, params.AuthzCheckParams, "resource", "r.resource_id")
	w.WriteString(`
  )`)
}

func writeFoothold(w ArgWriter, env Env, projectID string, principalType domain.AuthzPrincipalType, principalID string) {
	ptype := principalType.String()
	w.WriteString(`(
    EXISTS (
        SELECT 1
        FROM `)
	writeTable(w, env, "authz_assignments")
	w.WriteString(` a
        WHERE a.project_id = `)
	w.WriteArg(projectID)
	w.WriteString(`
          AND a.revoked_at IS NULL
          AND `)
	writeExpiresActive(w, env, "a")
	w.WriteString(`
          AND `)
	// Foothold is project-local: membership home is the protected project.
	writePrincipalMatch(w, env, "a", ptype, principalID, projectID)
	w.WriteString(`
    )
    OR EXISTS (
        SELECT 1
        FROM `)
	writeTable(w, env, "authz_membership_edges")
	w.WriteString(` e
        WHERE e.project_id = `)
	w.WriteArg(projectID)
	w.WriteString(`
          AND e.member_type = 'user'
          AND e.member_id = `)
	w.WriteArg(principalID)
	w.WriteString(`
          AND `)
	w.WriteArg(ptype)
	w.WriteString(` = 'user'
    )
)`)
}

func writeProjectScopedClosureExists(w ArgWriter, env Env, params domain.AuthzCheckParams) {
	writeScopedClosureExists(w, env, params, "project", "")
}

func writeScopedClosureExists(w ArgWriter, env Env, params domain.AuthzCheckParams, scopeKind, scopeIDExpr string) {
	home := params.HomeProjectID()
	ptype := params.PrincipalType.String()

	w.WriteString(`EXISTS (
        SELECT 1
        FROM `)
	writeTable(w, env, "authz_assignments")
	w.WriteString(` a
        JOIN `)
	writeTable(w, env, "authz_relation_closure")
	w.WriteString(` c
          ON  c.catalog_id       = a.catalog_id
          AND c.from_object_type = a.object_type
          AND c.from_relation    = a.relation
          AND c.to_object_type   = `)
	w.WriteArg(params.ObjectType)
	w.WriteString(`
          AND c.to_relation      = `)
	w.WriteArg(params.Relation)
	w.WriteString(`
        WHERE a.project_id = `)
	w.WriteArg(params.ProjectID)
	w.WriteString(`
          AND a.catalog_id = `)
	w.WriteArg(params.CatalogID)
	w.WriteString(`
          AND a.revoked_at IS NULL
          AND `)
	writeExpiresActive(w, env, "a")
	w.WriteString(`
          AND `)
	switch scopeKind {
	case "project":
		w.WriteString("a.scope_kind = 'project'")
	case "team":
		w.WriteString("a.scope_kind = 'team' AND a.scope_team_id = ")
		w.WriteString(scopeIDExpr)
	case "resource":
		w.WriteString("a.scope_kind = 'resource' AND a.scope_resource_id = ")
		w.WriteString(scopeIDExpr)
	default:
		panic("unknown scope kind " + scopeKind)
	}
	w.WriteString(`
          AND `)
	writePrincipalMatch(w, env, "a", ptype, params.PrincipalID, home)
	w.WriteString(`
    )`)
}

func writeFullTTUExists(w ArgWriter, env Env, params domain.AuthzCheckParams) {
	home := params.HomeProjectID()
	ptype := params.PrincipalType.String()

	w.WriteString(`EXISTS (
        SELECT 1
        FROM `)
	writeTable(w, env, "authz_expression_edges")
	w.WriteString(` edge
        JOIN `)
	writeTable(w, env, "authz_assignments")
	w.WriteString(` ts
          ON  ts.catalog_id  = edge.catalog_id
          AND ts.object_type = edge.tupleset_object_type
          AND ts.relation    = edge.tupleset_relation
          AND ts.principal_type = edge.source_object_type
          AND ts.project_id  = `)
	w.WriteArg(params.ProjectID)
	w.WriteString(`
          AND ts.revoked_at IS NULL
          AND `)
	writeExpiresActive(w, env, "ts")
	w.WriteString(`
        WHERE edge.catalog_id = `)
	w.WriteArg(params.CatalogID)
	w.WriteString(`
          AND edge.object_type = `)
	w.WriteArg(params.ObjectType)
	w.WriteString(`
          AND edge.relation = `)
	w.WriteArg(params.Relation)
	w.WriteString(`
          AND edge.kind = 'tuple_to_userset'
          AND (
                (
                    edge.source_object_type = 'team'
                AND edge.source_relation = 'member'
                AND ts.principal_type = 'team'
                AND `)
	w.WriteArg(ptype)
	w.WriteString(` = 'user'
                AND EXISTS (
                    SELECT 1
                    FROM `)
	writeTable(w, env, "authz_membership_edges")
	w.WriteString(` e
                    WHERE e.project_id = `)
	w.WriteArg(home)
	w.WriteString(`
                      AND e.set_type = 'team'
                      AND e.set_id = ts.principal_id
                      AND e.member_type = 'user'
                      AND e.member_id = `)
	w.WriteArg(params.PrincipalID)
	w.WriteString(`
                )
                )
             OR EXISTS (
                    SELECT 1
                    FROM `)
	writeTable(w, env, "authz_assignments")
	w.WriteString(` a
                    JOIN `)
	writeTable(w, env, "authz_relation_closure")
	w.WriteString(` c
                      ON  c.catalog_id       = a.catalog_id
                      AND c.from_object_type = a.object_type
                      AND c.from_relation    = a.relation
                      AND c.to_object_type   = edge.source_object_type
                      AND c.to_relation      = edge.source_relation
                    WHERE a.project_id = `)
	w.WriteArg(params.ProjectID)
	w.WriteString(`
                      AND a.catalog_id = `)
	w.WriteArg(params.CatalogID)
	w.WriteString(`
                      AND a.revoked_at IS NULL
                      AND `)
	writeExpiresActive(w, env, "a")
	w.WriteString(`
                      AND `)
	writePrincipalMatch(w, env, "a", ptype, params.PrincipalID, home)
	w.WriteString(`
                      AND (
                            (a.scope_kind = 'team' AND a.scope_team_id = ts.principal_id)
                         OR (a.scope_kind = 'resource' AND a.scope_resource_id = ts.principal_id)
                         OR (a.scope_kind = 'project' AND a.object_type = edge.source_object_type)
                      )
                )
          )
    )`)
}

func writePrincipalMatch(w ArgWriter, env Env, alias, principalType, principalID, homeProjectID string) {
	w.WriteString(`(
                (`)
	w.WriteString(alias)
	w.WriteString(`.principal_type = `)
	w.WriteArg(principalType)
	w.WriteString(` AND `)
	w.WriteString(alias)
	w.WriteString(`.principal_id = `)
	w.WriteArg(principalID)
	w.WriteString(`)
             OR (
                    `)
	w.WriteArg(principalType)
	w.WriteString(` = 'user'
                AND `)
	w.WriteString(alias)
	w.WriteString(`.principal_type = 'team'
                AND EXISTS (
                    SELECT 1
                    FROM `)
	writeTable(w, env, "authz_membership_edges")
	w.WriteString(` e
                    WHERE e.project_id = `)
	w.WriteArg(homeProjectID)
	w.WriteString(`
                      AND e.set_type = 'team'
                      AND e.set_id = `)
	w.WriteString(alias)
	w.WriteString(`.principal_id
                      AND e.member_type = 'user'
                      AND e.member_id = `)
	w.WriteArg(principalID)
	w.WriteString(`
                )
             )
          )`)
}
