package authz

import (
	"fmt"
	"strings"
)

// SQLStyle adapts shared resolver statement text to one SQL dialect.
type SQLStyle struct {
	// Schema is table qualifier including trailing dot, or empty (e.g. "zitadel_nextgen.").
	Schema string
	// Param returns the n-th bind placeholder (1-based), e.g. $1, ?1, @p1.
	Param func(n int) string
	// Now is a SQL expression or placeholder compared to expires_at
	// (e.g. "now()", "CURRENT_TIMESTAMP()", or Param(8)).
	Now string
}

func (s SQLStyle) table(name string) string {
	return s.Schema + name
}

func (s SQLStyle) p(n int) string {
	return s.Param(n)
}

// ActiveSystemCatalogID returns SELECT id … active system catalog.
// Binds: 1=catalog_kind, 2=owner_id, 3=status.
func (s SQLStyle) ActiveSystemCatalogID() string {
	return fmt.Sprintf(`
SELECT id
FROM %s
WHERE catalog_kind = %s AND owner_id = %s AND status = %s`,
		s.table("authz_catalogs"), s.p(1), s.p(2), s.p(3))
}

// HasAuthzProjectFoothold binds: 1=project_id, 2=principal_type, 3=principal_id
// [+ Now bind if Now is a placeholder used here — foothold uses Now].
func (s SQLStyle) HasAuthzProjectFoothold() string {
	return fmt.Sprintf(`
SELECT (
    EXISTS (
        SELECT 1
        FROM %s a
        WHERE a.project_id = %s
          AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > %s)
          AND %s
    )
    OR EXISTS (
        SELECT 1
        FROM %s e
        WHERE e.project_id = %s
          AND e.member_type = 'user'
          AND e.member_id = %s
          AND %s = 'user'
    )
)`,
		s.table("authz_assignments"), s.p(1), s.Now,
		s.principalMatch("a", 2, 3, 1),
		s.table("authz_membership_edges"), s.p(1), s.p(3), s.p(2),
	)
}

// CheckAuthz binds: 1=catalog, 2=project, 3=principal_type, 4=principal_id,
// 5=object_type, 6=relation, 7=principal_home_project [, Now if bound].
func (s SQLStyle) CheckAuthz() string {
	return fmt.Sprintf(`SELECT (%s OR %s)`,
		s.projectScopedClosureExists(),
		s.fullTTUExists(),
	)
}

// ListAuthzObjectIDs binds: 1=catalog, 2=project, 3=principal_type, 4=principal_id,
// 5=object_type, 6=relation, 7=principal_home_project, 8=resource_kind [, Now if bound].
func (s SQLStyle) ListAuthzObjectIDs() string {
	return fmt.Sprintf(`
SELECT r.resource_id
FROM %s r
WHERE r.project_id = %s
  AND r.resource_kind = %s
  AND (
    %s
    OR %s
    OR (
        r.team_id IS NOT NULL
        AND %s
    )
    OR %s
  )
ORDER BY r.resource_id`,
		s.table("resource_scope_index"), s.p(2), s.p(8),
		s.projectScopedClosureExists(),
		s.fullTTUExists(),
		s.scopedClosureExists("team", "r.team_id"),
		s.scopedClosureExists("resource", "r.resource_id"),
	)
}

func (s SQLStyle) projectScopedClosureExists() string {
	return s.scopedClosureExists("project", "")
}

func (s SQLStyle) scopedClosureExists(scopeKind, scopeIDExpr string) string {
	var scopePred string
	switch scopeKind {
	case "project":
		scopePred = "a.scope_kind = 'project'"
	case "team":
		scopePred = fmt.Sprintf("a.scope_kind = 'team' AND a.scope_team_id = %s", scopeIDExpr)
	case "resource":
		scopePred = fmt.Sprintf("a.scope_kind = 'resource' AND a.scope_resource_id = %s", scopeIDExpr)
	default:
		panic("unknown scope kind " + scopeKind)
	}
	return fmt.Sprintf(`EXISTS (
        SELECT 1
        FROM %s a
        JOIN %s c
          ON  c.catalog_id       = a.catalog_id
          AND c.from_object_type = a.object_type
          AND c.from_relation    = a.relation
          AND c.to_object_type   = %s
          AND c.to_relation      = %s
        WHERE a.project_id = %s
          AND a.catalog_id = %s
          AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > %s)
          AND %s
          AND %s
    )`,
		s.table("authz_assignments"), s.table("authz_relation_closure"),
		s.p(5), s.p(6),
		s.p(2), s.p(1), s.Now,
		scopePred,
		s.principalMatch("a", 3, 4, 7),
	)
}

func (s SQLStyle) fullTTUExists() string {
	return fmt.Sprintf(`EXISTS (
        SELECT 1
        FROM %s edge
        JOIN %s ts
          ON  ts.catalog_id  = edge.catalog_id
          AND ts.object_type = edge.tupleset_object_type
          AND ts.relation    = edge.tupleset_relation
          AND ts.project_id  = %s
          AND ts.revoked_at IS NULL
          AND (ts.expires_at IS NULL OR ts.expires_at > %s)
        WHERE edge.catalog_id = %s
          AND edge.object_type = %s
          AND edge.relation = %s
          AND edge.kind = 'tuple_to_userset'
          AND (
                (
                    edge.source_object_type = 'team'
                AND edge.source_relation = 'member'
                AND ts.principal_type = 'team'
                AND %s = 'user'
                AND EXISTS (
                    SELECT 1
                    FROM %s e
                    WHERE e.project_id = %s
                      AND e.set_type = 'team'
                      AND e.set_id = ts.principal_id
                      AND e.member_type = 'user'
                      AND e.member_id = %s
                )
                )
             OR EXISTS (
                    SELECT 1
                    FROM %s a
                    JOIN %s c
                      ON  c.catalog_id       = a.catalog_id
                      AND c.from_object_type = a.object_type
                      AND c.from_relation    = a.relation
                      AND c.to_object_type   = edge.source_object_type
                      AND c.to_relation      = edge.source_relation
                    WHERE a.project_id = %s
                      AND a.catalog_id = %s
                      AND a.revoked_at IS NULL
                      AND (a.expires_at IS NULL OR a.expires_at > %s)
                      AND %s
                      AND (
                            (a.scope_kind = 'team' AND a.scope_team_id = ts.principal_id)
                         OR (a.scope_kind = 'resource' AND a.scope_resource_id = ts.principal_id)
                         OR (a.scope_kind = 'project' AND a.object_type = edge.source_object_type)
                      )
                )
          )
    )`,
		s.table("authz_expression_edges"), s.table("authz_assignments"),
		s.p(2), s.Now,
		s.p(1), s.p(5), s.p(6),
		s.p(3),
		s.table("authz_membership_edges"), s.p(7), s.p(4),
		s.table("authz_assignments"), s.table("authz_relation_closure"),
		s.p(2), s.p(1), s.Now,
		s.principalMatch("a", 3, 4, 7),
	)
}

// principalMatch builds direct principal OR user-via-team-membership expand.
// typeParam/idParam/homeParam are 1-based bind indexes.
func (s SQLStyle) principalMatch(alias string, typeParam, idParam, homeParam int) string {
	var b strings.Builder
	fmt.Fprintf(&b, `(
                (%s.principal_type = %s AND %s.principal_id = %s)
             OR (
                    %s = 'user'
                AND %s.principal_type = 'team'
                AND EXISTS (
                    SELECT 1
                    FROM %s e
                    WHERE e.project_id = %s
                      AND e.set_type = 'team'
                      AND e.set_id = %s.principal_id
                      AND e.member_type = 'user'
                      AND e.member_id = %s
                )
             )
          )`,
		alias, s.p(typeParam), alias, s.p(idParam),
		s.p(typeParam), alias,
		s.table("authz_membership_edges"), s.p(homeParam), alias, s.p(idParam),
	)
	return b.String()
}

// Postgres uses $n placeholders and now().
func PostgresSQL() SQLStyle {
	return SQLStyle{
		Schema: "zitadel_nextgen.",
		Param:  func(n int) string { return fmt.Sprintf("$%d", n) },
		Now:    "now()",
	}
}

// SpannerSQL uses @pn placeholders and CURRENT_TIMESTAMP().
func SpannerSQL() SQLStyle {
	return SQLStyle{
		Param: func(n int) string { return fmt.Sprintf("@p%d", n) },
		Now:   "CURRENT_TIMESTAMP()",
	}
}

// SQLiteSQL uses ?n placeholders. nowParam is the bind index for unix-nano "now".
func SQLiteSQL(nowParam int) SQLStyle {
	return SQLStyle{
		Param: func(n int) string { return fmt.Sprintf("?%d", n) },
		Now:   fmt.Sprintf("?%d", nowParam),
	}
}
