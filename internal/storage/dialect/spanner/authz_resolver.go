package spanner

import (
	"context"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	activeSystemCatalogIDStmt = `
SELECT id
FROM authz_catalogs
WHERE catalog_kind = @p1 AND owner_id = @p2 AND status = @p3`

	hasAuthzProjectFootholdStmt = `
SELECT (
    EXISTS (
        SELECT 1
        FROM authz_assignments a
        WHERE a.project_id = @p1
          AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP())
          AND (
                (a.principal_type = @p2 AND a.principal_id = @p3)
             OR (
                    @p2 = 'user'
                AND a.principal_type = 'team'
                AND EXISTS (
                    SELECT 1
                    FROM authz_membership_edges e
                    WHERE e.project_id = @p1
                      AND e.set_type = 'team'
                      AND e.set_id = a.principal_id
                      AND e.member_type = 'user'
                      AND e.member_id = @p3
                )
             )
          )
    )
    OR EXISTS (
        SELECT 1
        FROM authz_membership_edges e
        WHERE e.project_id = @p1
          AND e.member_type = 'user'
          AND e.member_id = @p3
          AND @p2 = 'user'
    )
)`

	checkAuthzStmt = `
SELECT (
    EXISTS (
        SELECT 1
        FROM authz_assignments a
        JOIN authz_relation_closure c
          ON  c.catalog_id       = a.catalog_id
          AND c.from_object_type = a.object_type
          AND c.from_relation    = a.relation
          AND c.to_object_type   = @p5
          AND c.to_relation      = @p6
        WHERE a.project_id = @p2
          AND a.catalog_id = @p1
          AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP())
          AND a.scope_kind = 'project'
          AND (
                (a.principal_type = @p3 AND a.principal_id = @p4)
             OR (
                    @p3 = 'user'
                AND a.principal_type = 'team'
                AND EXISTS (
                    SELECT 1
                    FROM authz_membership_edges e
                    WHERE e.project_id = @p7
                      AND e.set_type = 'team'
                      AND e.set_id = a.principal_id
                      AND e.member_type = 'user'
                      AND e.member_id = @p4
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
          AND ts.project_id  = @p2
          AND ts.revoked_at IS NULL
          AND (ts.expires_at IS NULL OR ts.expires_at > CURRENT_TIMESTAMP())
        WHERE edge.catalog_id = @p1
          AND edge.object_type = @p5
          AND edge.relation = @p6
          AND edge.kind = 'tuple_to_userset'
          AND (
                (
                    edge.source_object_type = 'team'
                AND edge.source_relation = 'member'
                AND ts.principal_type = 'team'
                AND @p3 = 'user'
                AND EXISTS (
                    SELECT 1
                    FROM authz_membership_edges e
                    WHERE e.project_id = @p7
                      AND e.set_type = 'team'
                      AND e.set_id = ts.principal_id
                      AND e.member_type = 'user'
                      AND e.member_id = @p4
                )
                )
             OR EXISTS (
                    SELECT 1
                    FROM authz_assignments a
                    JOIN authz_relation_closure c
                      ON  c.catalog_id       = a.catalog_id
                      AND c.from_object_type = a.object_type
                      AND c.from_relation    = a.relation
                      AND c.to_object_type   = edge.source_object_type
                      AND c.to_relation      = edge.source_relation
                    WHERE a.project_id = @p2
                      AND a.catalog_id = @p1
                      AND a.revoked_at IS NULL
                      AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP())
                      AND (
                            (a.principal_type = @p3 AND a.principal_id = @p4)
                         OR (
                                @p3 = 'user'
                            AND a.principal_type = 'team'
                            AND EXISTS (
                                SELECT 1
                                FROM authz_membership_edges e
                                WHERE e.project_id = @p7
                                  AND e.set_type = 'team'
                                  AND e.set_id = a.principal_id
                                  AND e.member_type = 'user'
                                  AND e.member_id = @p4
                            )
                         )
                      )
                      AND (
                            (a.scope_kind = 'team' AND a.scope_team_id = ts.principal_id)
                         OR (a.scope_kind = 'resource' AND a.scope_resource_id = ts.principal_id)
                         OR (a.scope_kind = 'project' AND a.object_type = edge.source_object_type)
                      )
                )
          )
    )
)`

	listAuthzObjectIDsStmt = `
SELECT r.resource_id
FROM resource_scope_index r
WHERE r.project_id = @p2
  AND r.resource_kind = @p8
  AND (
    EXISTS (
        SELECT 1
        FROM authz_assignments a
        JOIN authz_relation_closure c
          ON  c.catalog_id       = a.catalog_id
          AND c.from_object_type = a.object_type
          AND c.from_relation    = a.relation
          AND c.to_object_type   = @p5
          AND c.to_relation      = @p6
        WHERE a.project_id = @p2
          AND a.catalog_id = @p1
          AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP())
          AND a.scope_kind = 'project'
          AND (
                (a.principal_type = @p3 AND a.principal_id = @p4)
             OR (
                    @p3 = 'user'
                AND a.principal_type = 'team'
                AND EXISTS (
                    SELECT 1
                    FROM authz_membership_edges e
                    WHERE e.project_id = @p7
                      AND e.set_type = 'team'
                      AND e.set_id = a.principal_id
                      AND e.member_type = 'user'
                      AND e.member_id = @p4
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
          AND ts.project_id  = @p2
          AND ts.revoked_at IS NULL
          AND (ts.expires_at IS NULL OR ts.expires_at > CURRENT_TIMESTAMP())
        WHERE edge.catalog_id = @p1
          AND edge.object_type = @p5
          AND edge.relation = @p6
          AND edge.kind = 'tuple_to_userset'
          AND edge.source_object_type = 'team'
          AND edge.source_relation = 'member'
          AND ts.principal_type = 'team'
          AND @p3 = 'user'
          AND EXISTS (
                SELECT 1
                FROM authz_membership_edges e
                WHERE e.project_id = @p7
                  AND e.set_type = 'team'
                  AND e.set_id = ts.principal_id
                  AND e.member_type = 'user'
                  AND e.member_id = @p4
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
              AND c.to_object_type   = @p5
              AND c.to_relation      = @p6
            WHERE a.project_id = @p2
              AND a.catalog_id = @p1
              AND a.revoked_at IS NULL
              AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP())
              AND a.scope_kind = 'team'
              AND a.scope_team_id = r.team_id
              AND (
                    (a.principal_type = @p3 AND a.principal_id = @p4)
                 OR (
                        @p3 = 'user'
                    AND a.principal_type = 'team'
                    AND EXISTS (
                        SELECT 1
                        FROM authz_membership_edges e
                        WHERE e.project_id = @p7
                          AND e.set_type = 'team'
                          AND e.set_id = a.principal_id
                          AND e.member_type = 'user'
                          AND e.member_id = @p4
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
          AND c.to_object_type   = @p5
          AND c.to_relation      = @p6
        WHERE a.project_id = @p2
          AND a.catalog_id = @p1
          AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP())
          AND a.scope_kind = 'resource'
          AND a.scope_resource_id = r.resource_id
          AND (
                (a.principal_type = @p3 AND a.principal_id = @p4)
             OR (
                    @p3 = 'user'
                AND a.principal_type = 'team'
                AND EXISTS (
                    SELECT 1
                    FROM authz_membership_edges e
                    WHERE e.project_id = @p7
                      AND e.set_type = 'team'
                      AND e.set_id = a.principal_id
                      AND e.member_type = 'user'
                      AND e.member_id = @p4
                )
             )
          )
    )
  )
ORDER BY r.resource_id`
)

type authzResolverStatements struct{ statement }

func newAuthzResolverStatements(db queryExecutor) authzResolverStatements {
	return authzResolverStatements{statement: statement{db: db}}
}

// ActiveSystemCatalogID implements [service.AuthzResolverStatements].
func (s authzResolverStatements) ActiveSystemCatalogID(ctx context.Context) (string, error) {
	var id string
	err := s.db.Query(ctx, buildStatement(activeSystemCatalogIDStmt,
		domain.AuthzCatalogKindSystem.String(),
		domain.SystemCatalogOwnerID,
		domain.AuthzCatalogStatusActive.String(),
	).statement(), func(iter *spanner.RowIterator) error {
		var qErr error
		id, qErr = collectOneRow(iter, func(row *spanner.Row) (string, error) {
			var found string
			return found, row.Columns(&found)
		})
		return qErr
	})
	if err != nil {
		return "", wrapError(err)
	}
	return id, nil
}

// HasAuthzProjectFoothold implements [service.AuthzResolverStatements].
func (s authzResolverStatements) HasAuthzProjectFoothold(ctx context.Context, projectID string, principalType domain.AuthzPrincipalType, principalID string) (bool, error) {
	var ok bool
	err := s.db.Query(ctx, buildStatement(hasAuthzProjectFootholdStmt,
		projectID, principalType.String(), principalID,
	).statement(), func(iter *spanner.RowIterator) error {
		var qErr error
		ok, qErr = collectOneRow(iter, func(row *spanner.Row) (bool, error) {
			var found bool
			return found, row.Columns(&found)
		})
		return qErr
	})
	if err != nil {
		return false, wrapError(err)
	}
	return ok, nil
}

// CheckAuthz implements [service.AuthzResolverStatements].
func (s authzResolverStatements) CheckAuthz(ctx context.Context, params domain.AuthzCheckParams) (bool, error) {
	home := params.PrincipalHomeProjectID
	if home == "" {
		home = params.ProjectID
	}
	var ok bool
	err := s.db.Query(ctx, buildStatement(checkAuthzStmt,
		params.CatalogID,
		params.ProjectID,
		params.PrincipalType.String(),
		params.PrincipalID,
		params.ObjectType,
		params.Relation,
		home,
	).statement(), func(iter *spanner.RowIterator) error {
		var qErr error
		ok, qErr = collectOneRow(iter, func(row *spanner.Row) (bool, error) {
			var found bool
			return found, row.Columns(&found)
		})
		return qErr
	})
	if err != nil {
		return false, wrapError(err)
	}
	return ok, nil
}

// ListAuthzObjectIDs implements [service.AuthzResolverStatements].
func (s authzResolverStatements) ListAuthzObjectIDs(ctx context.Context, params domain.AuthzListObjectsParams) ([]string, error) {
	home := params.PrincipalHomeProjectID
	if home == "" {
		home = params.ProjectID
	}
	var ids []string
	err := s.db.Query(ctx, buildStatement(listAuthzObjectIDsStmt,
		params.CatalogID,
		params.ProjectID,
		params.PrincipalType.String(),
		params.PrincipalID,
		params.ObjectType,
		params.Relation,
		home,
		params.ResourceKind.String(),
	).statement(), func(iter *spanner.RowIterator) error {
		var qErr error
		ids, qErr = collectRows(iter, func(row *spanner.Row) (string, error) {
			var id string
			return id, row.Columns(&id)
		})
		return qErr
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return ids, nil
}

var _ service.AuthzResolverStatements = (*authzResolverStatements)(nil)
