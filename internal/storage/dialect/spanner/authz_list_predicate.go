package spanner

import (
	"context"

	"github.com/zitadel/nextgen/internal/service"
)

const rsiTable = "resource_scope_index"

// writeAuthzListPredicate appends an EXISTS conjunct that authorizes the outer
// resource row via resource_scope_index + the same assignment/closure/TTU
// branches as ListAuthzObjectIDs — one SQL round-trip, no IN (ids).
func writeAuthzListPredicate(c *statementCompiler, hasWhere *bool, outerResourceIDCol string, f service.AuthzListFilter) {
	writeConjunct(c, hasWhere)
	c.WriteString("EXISTS (SELECT 1 FROM ")
	c.WriteString(rsiTable)
	c.WriteString(" r WHERE r.resource_id = ")
	c.WriteString(outerResourceIDCol)
	c.WriteString(" AND r.project_id = ")
	c.WriteArg(f.ProjectID)
	c.WriteString(" AND r.resource_kind = ")
	c.WriteArg(f.ResourceKind.String())
	c.WriteString(" AND (")
	writeAuthzListBranches(c, f)
	c.WriteString("))")
}

func writeAuthzListBranches(c *statementCompiler, f service.AuthzListFilter) {
	// Project-scoped grant.
	c.WriteString(`EXISTS (
        SELECT 1
        FROM authz_assignments a
        JOIN authz_relation_closure c
          ON  c.catalog_id       = a.catalog_id
          AND c.from_object_type = a.object_type
          AND c.from_relation    = a.relation
          AND c.to_object_type   = `)
	c.WriteArg(f.ObjectType)
	c.WriteString(`
          AND c.to_relation      = `)
	c.WriteArg(f.Relation)
	c.WriteString(`
        WHERE a.project_id = `)
	c.WriteArg(f.ProjectID)
	c.WriteString(`
          AND a.catalog_id = `)
	c.WriteArg(f.CatalogID)
	c.WriteString(`
          AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP())
          AND a.scope_kind = 'project'
          AND (
                (a.principal_type = `)
	c.WriteArg(f.PrincipalType.String())
	c.WriteString(` AND a.principal_id = `)
	c.WriteArg(f.PrincipalID)
	c.WriteString(`)
             OR (
                    `)
	c.WriteArg(f.PrincipalType.String())
	c.WriteString(` = 'user'
                AND a.principal_type = 'team'
                AND EXISTS (
                    SELECT 1
                    FROM authz_membership_edges e
                    WHERE e.project_id = `)
	c.WriteArg(f.PrincipalHomeProjectID)
	c.WriteString(`
                      AND e.set_type = 'team'
                      AND e.set_id = a.principal_id
                      AND e.member_type = 'user'
                      AND e.member_id = `)
	c.WriteArg(f.PrincipalID)
	c.WriteString(`
                )
             )
          )
    )
    OR EXISTS (
        SELECT 1
        FROM authz_expression_edges edge
        JOIN authz_assignments ts
          ON  ts.catalog_id  = edge.catalog_id
          AND ts.object_type = edge.tupleset_object_type
          AND ts.relation    = edge.tupleset_relation
          AND ts.project_id  = `)
	c.WriteArg(f.ProjectID)
	c.WriteString(`
          AND ts.revoked_at IS NULL
          AND (ts.expires_at IS NULL OR ts.expires_at > CURRENT_TIMESTAMP())
        WHERE edge.catalog_id = `)
	c.WriteArg(f.CatalogID)
	c.WriteString(`
          AND edge.object_type = `)
	c.WriteArg(f.ObjectType)
	c.WriteString(`
          AND edge.relation = `)
	c.WriteArg(f.Relation)
	c.WriteString(`
          AND edge.kind = 'tuple_to_userset'
          AND edge.source_object_type = 'team'
          AND edge.source_relation = 'member'
          AND ts.principal_type = 'team'
          AND `)
	c.WriteArg(f.PrincipalType.String())
	c.WriteString(` = 'user'
          AND EXISTS (
                SELECT 1
                FROM authz_membership_edges e
                WHERE e.project_id = `)
	c.WriteArg(f.PrincipalHomeProjectID)
	c.WriteString(`
                  AND e.set_type = 'team'
                  AND e.set_id = ts.principal_id
                  AND e.member_type = 'user'
                  AND e.member_id = `)
	c.WriteArg(f.PrincipalID)
	c.WriteString(`
          )
    )
    OR (
        r.team_id IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM authz_assignments a
            JOIN authz_relation_closure c
              ON  c.catalog_id       = a.catalog_id
              AND c.from_object_type = a.object_type
              AND c.from_relation    = a.relation
              AND c.to_object_type   = `)
	c.WriteArg(f.ObjectType)
	c.WriteString(`
              AND c.to_relation      = `)
	c.WriteArg(f.Relation)
	c.WriteString(`
            WHERE a.project_id = `)
	c.WriteArg(f.ProjectID)
	c.WriteString(`
              AND a.catalog_id = `)
	c.WriteArg(f.CatalogID)
	c.WriteString(`
              AND a.revoked_at IS NULL
              AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP())
              AND a.scope_kind = 'team'
              AND a.scope_team_id = r.team_id
              AND (
                    (a.principal_type = `)
	c.WriteArg(f.PrincipalType.String())
	c.WriteString(` AND a.principal_id = `)
	c.WriteArg(f.PrincipalID)
	c.WriteString(`)
                 OR (
                        `)
	c.WriteArg(f.PrincipalType.String())
	c.WriteString(` = 'user'
                    AND a.principal_type = 'team'
                    AND EXISTS (
                        SELECT 1
                        FROM authz_membership_edges e
                        WHERE e.project_id = `)
	c.WriteArg(f.PrincipalHomeProjectID)
	c.WriteString(`
                          AND e.set_type = 'team'
                          AND e.set_id = a.principal_id
                          AND e.member_type = 'user'
                          AND e.member_id = `)
	c.WriteArg(f.PrincipalID)
	c.WriteString(`
                    )
                 )
              )
        )
    )
    OR EXISTS (
        SELECT 1
        FROM authz_assignments a
        JOIN authz_relation_closure c
          ON  c.catalog_id       = a.catalog_id
          AND c.from_object_type = a.object_type
          AND c.from_relation    = a.relation
          AND c.to_object_type   = `)
	c.WriteArg(f.ObjectType)
	c.WriteString(`
          AND c.to_relation      = `)
	c.WriteArg(f.Relation)
	c.WriteString(`
        WHERE a.project_id = `)
	c.WriteArg(f.ProjectID)
	c.WriteString(`
          AND a.catalog_id = `)
	c.WriteArg(f.CatalogID)
	c.WriteString(`
          AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP())
          AND a.scope_kind = 'resource'
          AND a.scope_resource_id = r.resource_id
          AND (
                (a.principal_type = `)
	c.WriteArg(f.PrincipalType.String())
	c.WriteString(` AND a.principal_id = `)
	c.WriteArg(f.PrincipalID)
	c.WriteString(`)
             OR (
                    `)
	c.WriteArg(f.PrincipalType.String())
	c.WriteString(` = 'user'
                AND a.principal_type = 'team'
                AND EXISTS (
                    SELECT 1
                    FROM authz_membership_edges e
                    WHERE e.project_id = `)
	c.WriteArg(f.PrincipalHomeProjectID)
	c.WriteString(`
                      AND e.set_type = 'team'
                      AND e.set_id = a.principal_id
                      AND e.member_type = 'user'
                      AND e.member_id = `)
	c.WriteArg(f.PrincipalID)
	c.WriteString(`
                )
             )
          )
    )`)
}

func maybeWriteAuthzListPredicate(ctx context.Context, c *statementCompiler, hasWhere *bool, tableAliasOrName, resourceIDCol string) {
	f, ok := service.AuthzListFilterFromContext(ctx)
	if !ok {
		return
	}
	outer := tableAliasOrName + "." + resourceIDCol
	writeAuthzListPredicate(c, hasWhere, outer, f)
}
