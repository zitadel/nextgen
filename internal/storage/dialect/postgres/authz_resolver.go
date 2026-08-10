package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	activeSystemCatalogIDStmt = `
SELECT id
FROM zitadel_nextgen.authz_catalogs
WHERE catalog_kind = $1 AND owner_id = $2 AND status = $3`

	hasAuthzProjectFootholdStmt = `
SELECT (
    EXISTS (
        SELECT 1
        FROM zitadel_nextgen.authz_assignments a
        WHERE a.project_id = $1
          AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > now())
          AND (
                (a.principal_type = $2 AND a.principal_id = $3)
             OR (
                    $2 = 'user'
                AND a.principal_type = 'team'
                AND EXISTS (
                    SELECT 1
                    FROM zitadel_nextgen.authz_membership_edges e
                    WHERE e.project_id = $1
                      AND e.set_type = 'team'
                      AND e.set_id = a.principal_id
                      AND e.member_type = 'user'
                      AND e.member_id = $3
                )
             )
          )
    )
    OR EXISTS (
        SELECT 1
        FROM zitadel_nextgen.authz_membership_edges e
        WHERE e.project_id = $1
          AND e.member_type = 'user'
          AND e.member_id = $3
          AND $2 = 'user'
    )
)`

	// checkAuthzStmt allows via (1) assignment ⋈ closure or (2) bounded TTU
	// through authz_expression_edges + tupleset assignment + membership/source.
	checkAuthzStmt = `
SELECT (
    EXISTS (
        SELECT 1
        FROM zitadel_nextgen.authz_assignments a
        JOIN zitadel_nextgen.authz_relation_closure c
          ON  c.catalog_id       = a.catalog_id
          AND c.from_object_type = a.object_type
          AND c.from_relation    = a.relation
          AND c.to_object_type   = $5
          AND c.to_relation      = $6
        WHERE a.project_id = $2
          AND a.catalog_id = $1
          AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > now())
          AND (
                (a.principal_type = $3 AND a.principal_id = $4)
             OR (
                    $3 = 'user'
                AND a.principal_type = 'team'
                AND EXISTS (
                    SELECT 1
                    FROM zitadel_nextgen.authz_membership_edges e
                    WHERE e.project_id = $7
                      AND e.set_type = 'team'
                      AND e.set_id = a.principal_id
                      AND e.member_type = 'user'
                      AND e.member_id = $4
                )
             )
          )
    )
    OR EXISTS (
        SELECT 1
        FROM zitadel_nextgen.authz_expression_edges edge
        JOIN zitadel_nextgen.authz_assignments ts
          ON  ts.catalog_id  = edge.catalog_id
          AND ts.object_type = edge.tupleset_object_type
          AND ts.relation    = edge.tupleset_relation
          AND ts.project_id  = $2
          AND ts.revoked_at IS NULL
          AND (ts.expires_at IS NULL OR ts.expires_at > now())
        WHERE edge.catalog_id = $1
          AND edge.object_type = $5
          AND edge.relation = $6
          AND edge.kind = 'tuple_to_userset'
          AND (
                (
                    edge.source_object_type = 'team'
                AND edge.source_relation = 'member'
                AND ts.principal_type = 'team'
                AND $3 = 'user'
                AND EXISTS (
                    SELECT 1
                    FROM zitadel_nextgen.authz_membership_edges e
                    WHERE e.project_id = $7
                      AND e.set_type = 'team'
                      AND e.set_id = ts.principal_id
                      AND e.member_type = 'user'
                      AND e.member_id = $4
                )
                )
             OR EXISTS (
                    SELECT 1
                    FROM zitadel_nextgen.authz_assignments a
                    JOIN zitadel_nextgen.authz_relation_closure c
                      ON  c.catalog_id       = a.catalog_id
                      AND c.from_object_type = a.object_type
                      AND c.from_relation    = a.relation
                      AND c.to_object_type   = edge.source_object_type
                      AND c.to_relation      = edge.source_relation
                    WHERE a.project_id = $2
                      AND a.catalog_id = $1
                      AND a.revoked_at IS NULL
                      AND (a.expires_at IS NULL OR a.expires_at > now())
                      AND (
                            (a.principal_type = $3 AND a.principal_id = $4)
                         OR (
                                $3 = 'user'
                            AND a.principal_type = 'team'
                            AND EXISTS (
                                SELECT 1
                                FROM zitadel_nextgen.authz_membership_edges e
                                WHERE e.project_id = $7
                                  AND e.set_type = 'team'
                                  AND e.set_id = a.principal_id
                                  AND e.member_type = 'user'
                                  AND e.member_id = $4
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
FROM zitadel_nextgen.resource_scope_index r
WHERE r.project_id = $2
  AND r.resource_kind = $8
  AND (
    -- Project-scoped (or any) grant that CheckAuthz would accept for the project.
    EXISTS (
        SELECT 1
        FROM zitadel_nextgen.authz_assignments a
        JOIN zitadel_nextgen.authz_relation_closure c
          ON  c.catalog_id       = a.catalog_id
          AND c.from_object_type = a.object_type
          AND c.from_relation    = a.relation
          AND c.to_object_type   = $5
          AND c.to_relation      = $6
        WHERE a.project_id = $2
          AND a.catalog_id = $1
          AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > now())
          AND a.scope_kind = 'project'
          AND (
                (a.principal_type = $3 AND a.principal_id = $4)
             OR (
                    $3 = 'user'
                AND a.principal_type = 'team'
                AND EXISTS (
                    SELECT 1
                    FROM zitadel_nextgen.authz_membership_edges e
                    WHERE e.project_id = $7
                      AND e.set_type = 'team'
                      AND e.set_id = a.principal_id
                      AND e.member_type = 'user'
                      AND e.member_id = $4
                )
             )
          )
    )
    OR EXISTS (
        SELECT 1
        FROM zitadel_nextgen.authz_expression_edges edge
        JOIN zitadel_nextgen.authz_assignments ts
          ON  ts.catalog_id  = edge.catalog_id
          AND ts.object_type = edge.tupleset_object_type
          AND ts.relation    = edge.tupleset_relation
          AND ts.project_id  = $2
          AND ts.revoked_at IS NULL
          AND (ts.expires_at IS NULL OR ts.expires_at > now())
        WHERE edge.catalog_id = $1
          AND edge.object_type = $5
          AND edge.relation = $6
          AND edge.kind = 'tuple_to_userset'
          AND edge.source_object_type = 'team'
          AND edge.source_relation = 'member'
          AND ts.principal_type = 'team'
          AND $3 = 'user'
          AND EXISTS (
                SELECT 1
                FROM zitadel_nextgen.authz_membership_edges e
                WHERE e.project_id = $7
                  AND e.set_type = 'team'
                  AND e.set_id = ts.principal_id
                  AND e.member_type = 'user'
                  AND e.member_id = $4
          )
    )
    OR (
        r.team_id IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM zitadel_nextgen.authz_assignments a
            JOIN zitadel_nextgen.authz_relation_closure c
              ON  c.catalog_id       = a.catalog_id
              AND c.from_object_type = a.object_type
              AND c.from_relation    = a.relation
              AND c.to_object_type   = $5
              AND c.to_relation      = $6
            WHERE a.project_id = $2
              AND a.catalog_id = $1
              AND a.revoked_at IS NULL
              AND (a.expires_at IS NULL OR a.expires_at > now())
              AND a.scope_kind = 'team'
              AND a.scope_team_id = r.team_id
              AND (
                    (a.principal_type = $3 AND a.principal_id = $4)
                 OR (
                        $3 = 'user'
                    AND a.principal_type = 'team'
                    AND EXISTS (
                        SELECT 1
                        FROM zitadel_nextgen.authz_membership_edges e
                        WHERE e.project_id = $7
                          AND e.set_type = 'team'
                          AND e.set_id = a.principal_id
                          AND e.member_type = 'user'
                          AND e.member_id = $4
                    )
                 )
              )
        )
    )
    OR EXISTS (
        SELECT 1
        FROM zitadel_nextgen.authz_assignments a
        JOIN zitadel_nextgen.authz_relation_closure c
          ON  c.catalog_id       = a.catalog_id
          AND c.from_object_type = a.object_type
          AND c.from_relation    = a.relation
          AND c.to_object_type   = $5
          AND c.to_relation      = $6
        WHERE a.project_id = $2
          AND a.catalog_id = $1
          AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > now())
          AND a.scope_kind = 'resource'
          AND a.scope_resource_id = r.resource_id
          AND (
                (a.principal_type = $3 AND a.principal_id = $4)
             OR (
                    $3 = 'user'
                AND a.principal_type = 'team'
                AND EXISTS (
                    SELECT 1
                    FROM zitadel_nextgen.authz_membership_edges e
                    WHERE e.project_id = $7
                      AND e.set_type = 'team'
                      AND e.set_id = a.principal_id
                      AND e.member_type = 'user'
                      AND e.member_id = $4
                )
             )
          )
    )
  )
ORDER BY r.resource_id`
)

type authzResolverStatements struct{ statement }

func newAuthzResolverStatements(client queryExecutor) authzResolverStatements {
	return authzResolverStatements{statement: statement{client: client}}
}

// ActiveSystemCatalogID implements [service.AuthzResolverStatements].
func (s authzResolverStatements) ActiveSystemCatalogID(ctx context.Context) (string, error) {
	var id string
	err := s.client.QueryRow(ctx, activeSystemCatalogIDStmt,
		domain.AuthzCatalogKindSystem.String(),
		domain.SystemCatalogOwnerID,
		domain.AuthzCatalogStatusActive.String(),
	).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", database.NewNoRowFoundError(nil)
		}
		return "", wrapError(err)
	}
	return id, nil
}

// HasAuthzProjectFoothold implements [service.AuthzResolverStatements].
func (s authzResolverStatements) HasAuthzProjectFoothold(ctx context.Context, projectID string, principalType domain.AuthzPrincipalType, principalID string) (bool, error) {
	var ok bool
	err := s.client.QueryRow(ctx, hasAuthzProjectFootholdStmt,
		projectID, principalType.String(), principalID,
	).Scan(&ok)
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
	err := s.client.QueryRow(ctx, checkAuthzStmt,
		params.CatalogID,
		params.ProjectID,
		params.PrincipalType.String(),
		params.PrincipalID,
		params.ObjectType,
		params.Relation,
		home,
	).Scan(&ok)
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
	rows, err := s.client.Query(ctx, listAuthzObjectIDsStmt,
		params.CatalogID,
		params.ProjectID,
		params.PrincipalType.String(),
		params.PrincipalID,
		params.ObjectType,
		params.Relation,
		home,
		params.ResourceKind.String(),
	)
	if err != nil {
		return nil, wrapError(err)
	}
	ids, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (string, error) {
		var id string
		return id, row.Scan(&id)
	})
	if err != nil {
		return nil, wrapError(err)
	}
	if ids == nil {
		ids = []string{}
	}
	return ids, nil
}

var _ service.AuthzResolverStatements = (*authzResolverStatements)(nil)
