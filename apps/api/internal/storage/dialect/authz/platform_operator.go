package authz

import (
	"github.com/zitadel/nextgen/internal/domain"
)

// WriteCheckPlatformOperator emits SELECT (the platform operator path allows).
// The resolver asks it only after the protected project's grants did not allow
// (ADR 075 §3).
func WriteCheckPlatformOperator(w ArgWriter, env Env, params domain.AuthzPlatformCheckParams) {
	w.WriteString("SELECT ")
	writePlatformOperatorExists(w, env, params)
}

// writePlatformOperatorExists emits EXISTS (…) for ADR 075's operator path. It
// reads like writeFullTTUExists from the other side, with the two differences
// that make it the deployment-wide relation rather than a project-local one:
//
//   - The tupleset is implied. Every object hangs off the deployment's one
//     platform object, so there is no tupleset row to join, only the edge whose
//     tupleset is the checked type's platform relation.
//   - The user-side assignment lives in the platform project, not in the
//     project being checked. It names the user directly, with no team
//     expansion, and counts only while that user is active there (#1234).
//
// It references no outer row, so a list predicate evaluates it once.
func writePlatformOperatorExists(w ArgWriter, env Env, params domain.AuthzPlatformCheckParams) {
	w.WriteString(`EXISTS (
        SELECT 1
        FROM `)
	writeTable(w, env, "authz_expression_edges")
	w.WriteString(` edge
        JOIN `)
	writeTable(w, env, "authz_relation_closure")
	w.WriteString(` ec
          ON  ec.catalog_id       = edge.catalog_id
          AND ec.from_object_type = edge.object_type
          AND ec.from_relation    = edge.relation
          AND ec.to_object_type   = `)
	w.WriteArg(params.ObjectType)
	w.WriteString(`
          AND ec.to_relation      = `)
	w.WriteArg(params.Relation)
	w.WriteString(`
        JOIN `)
	writeTable(w, env, "authz_relation_closure")
	w.WriteString(` c
          ON  c.catalog_id     = edge.catalog_id
          AND c.to_object_type = edge.source_object_type
          AND c.to_relation    = edge.source_relation
        JOIN `)
	writeTable(w, env, "authz_assignments")
	w.WriteString(` a
          ON  a.catalog_id  = c.catalog_id
          AND a.object_type = c.from_object_type
          AND a.relation    = c.from_relation
        WHERE edge.catalog_id = `)
	w.WriteArg(params.CatalogID)
	w.WriteString(`
          AND edge.kind = 'tuple_to_userset'
          AND edge.tupleset_object_type = edge.object_type
          AND edge.tupleset_relation = `)
	w.WriteArg(domain.AuthzTuplesetPlatform)
	w.WriteString(`
          AND edge.source_object_type = `)
	w.WriteArg(domain.AuthzObjectTypePlatform)
	w.WriteString(`
          AND a.project_id = `)
	w.WriteArg(params.PlatformProjectID)
	w.WriteString(`
          AND a.scope_kind = 'project'
          AND a.revoked_at IS NULL
          AND `)
	writeExpiresActive(w, env, "a")
	w.WriteString(`
          AND `)
	writeDirectPrincipal(w, "a", domain.AuthzPrincipalTypeUser.String(), params.UserID)
	w.WriteString(`
          AND EXISTS (
            SELECT 1
            FROM `)
	writeTable(w, env, "users")
	w.WriteString(` u
            WHERE u.project_id = `)
	w.WriteArg(params.PlatformProjectID)
	w.WriteString(`
              AND u.id = `)
	w.WriteArg(params.UserID)
	w.WriteString(`
              AND u.status = `)
	w.WriteArg(domain.UserStatusActive.String())
	w.WriteString(`
          )
    )`)
}
