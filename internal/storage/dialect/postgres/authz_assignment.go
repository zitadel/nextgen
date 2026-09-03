package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	createAuthzAssignmentStmt = `
INSERT INTO zitadel_nextgen.authz_assignments (
    id, project_id, catalog_id,
    principal_type, principal_id, object_type, relation,
    scope_kind, scope_team_id, scope_resource_id,
    grantor_type, grantor_id, delegation_id,
    expires_at, revoked_at
) VALUES (
    $1, $2, $3,
    $4, $5, $6, $7,
    $8, $9, $10,
    $11, $12, $13,
    $14, $15
) RETURNING created_at, updated_at`

	getAuthzAssignmentStmt = `
SELECT id, project_id, catalog_id,
       principal_type, principal_id, object_type, relation,
       scope_kind, scope_team_id, scope_resource_id,
       grantor_type, grantor_id, delegation_id,
       expires_at, revoked_at, created_at, updated_at
FROM zitadel_nextgen.authz_assignments
WHERE project_id = $1 AND id = $2`

	listManagedGrantsQuery = `
SELECT id, project_id, catalog_id,
       principal_type, principal_id, object_type, relation,
       scope_kind, scope_team_id, scope_resource_id,
       grantor_type, grantor_id, delegation_id,
       expires_at, revoked_at, created_at, updated_at
FROM zitadel_nextgen.authz_assignments`

	listAuthzAssignmentsStmt = `
SELECT id, project_id, catalog_id,
       principal_type, principal_id, object_type, relation,
       scope_kind, scope_team_id, scope_resource_id,
       grantor_type, grantor_id, delegation_id,
       expires_at, revoked_at, created_at, updated_at
FROM zitadel_nextgen.authz_assignments
WHERE project_id = $1 AND principal_type = $2 AND principal_id = $3
  AND ($4::bool OR revoked_at IS NULL)
ORDER BY created_at, id`

	revokeAuthzAssignmentStmt = `
UPDATE zitadel_nextgen.authz_assignments
SET revoked_at = now(), updated_at = now()
WHERE project_id = $1 AND id = $2 AND revoked_at IS NULL
RETURNING revoked_at, updated_at`

	// Literal 'project'/'team' so the planner can serve this from the partial
	// index authz_assignments_one_owning_team; the relation names match
	// domain.NewClaimTeamAssignment and the seeded system catalog.
	getActiveOwningTeamGrantStmt = `
SELECT id, project_id, catalog_id,
       principal_type, principal_id, object_type, relation,
       scope_kind, scope_team_id, scope_resource_id,
       grantor_type, grantor_id, delegation_id,
       expires_at, revoked_at, created_at, updated_at
FROM zitadel_nextgen.authz_assignments
WHERE project_id = $1 AND object_type = 'project' AND relation = 'team'
  AND revoked_at IS NULL
ORDER BY created_at, id
LIMIT 1`

	listClaimedProjectIDsStmt = `
SELECT DISTINCT project_id FROM zitadel_nextgen.authz_assignments
WHERE object_type = 'project' AND relation = 'team' AND revoked_at IS NULL
  AND ($1 = '' OR project_id > $1)
ORDER BY project_id
LIMIT $2`
)

type authzAssignmentStatements struct{ statement }

func newAuthzAssignmentStatements(client queryExecutor) authzAssignmentStatements {
	return authzAssignmentStatements{
		statement: statement{
			client: client,
		},
	}
}

// CreateAuthzAssignment implements [service.AuthzAssignmentStatements].
func (s authzAssignmentStatements) CreateAuthzAssignment(ctx context.Context, a *domain.AuthzAssignment) error {
	if err := authz.ValidateAssignment(a); err != nil {
		return err
	}
	if err := ensureManagedID(&a.ID, domain.PrefixAuthzAssignment); err != nil {
		return err
	}
	return wrapError(s.client.QueryRow(ctx, createAuthzAssignmentStmt,
		a.ID, a.ProjectID, a.CatalogID,
		a.PrincipalType.String(), a.PrincipalID, a.ObjectType, a.Relation,
		a.ScopeKind.String(), a.ScopeTeamID, a.ScopeResourceID,
		a.GrantorType, a.GrantorID, a.DelegationID,
		a.ExpiresAt, a.RevokedAt,
	).Scan(&a.CreatedAt, &a.UpdatedAt))
}

// GetAuthzAssignment implements [service.AuthzAssignmentStatements].
func (s authzAssignmentStatements) GetAuthzAssignment(ctx context.Context, projectID, id string) (*domain.AuthzAssignment, error) {
	rows, err := s.client.Query(ctx, getAuthzAssignmentStmt, projectID, id)
	if err != nil {
		return nil, wrapError(err)
	}
	assignment, err := pgx.CollectExactlyOneRow(rows, scanAuthzAssignment)
	if err != nil {
		return nil, wrapError(err)
	}
	return assignment, nil
}

// ListAuthzAssignments implements [service.AuthzAssignmentStatements].
func (s authzAssignmentStatements) ListAuthzAssignments(ctx context.Context, projectID string, principalType domain.AuthzPrincipalType, principalID string, includeRevoked bool) ([]*domain.AuthzAssignment, error) {
	rows, err := s.client.Query(ctx, listAuthzAssignmentsStmt, projectID, principalType.String(), principalID, includeRevoked)
	if err != nil {
		return nil, wrapError(err)
	}
	assignments, err := pgx.CollectRows(rows, scanAuthzAssignment)
	if err != nil {
		return nil, wrapError(err)
	}
	return assignments, nil
}

// ListManagedGrants implements [service.AuthzAssignmentStatements].
func (s authzAssignmentStatements) ListManagedGrants(ctx context.Context, filter *database.ListOptions[domain.AuthzAssignmentField]) (*database.ListResult[*domain.AuthzAssignment], error) {
	var compiler statementCompiler
	if err := compileList(ctx, &compiler, listManagedGrantsQuery, filter, authzAssignmentSchema, "", "", authz.ManagedGrantListConjunct); err != nil {
		return nil, err
	}
	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	assignments, err := pgx.CollectRows(rows, scanAuthzAssignment)
	if err != nil {
		return nil, wrapError(err)
	}
	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		assignments,
		authzAssignmentSchema,
		filter.Pagination.Limit,
	)
	return &database.ListResult[*domain.AuthzAssignment]{
		Items:      assignments,
		NextCursor: nextCursor,
	}, nil
}
func (s authzAssignmentStatements) RevokeAuthzAssignment(ctx context.Context, projectID, id string) error {
	var revokedAt, updatedAt time.Time
	return wrapError(s.client.QueryRow(ctx, revokeAuthzAssignmentStmt, projectID, id).Scan(&revokedAt, &updatedAt))
}

// GetActiveOwningTeamGrant implements [service.AuthzAssignmentStatements].
func (s authzAssignmentStatements) GetActiveOwningTeamGrant(ctx context.Context, projectID string) (*domain.AuthzAssignment, error) {
	rows, err := s.client.Query(ctx, getActiveOwningTeamGrantStmt, projectID)
	if err != nil {
		return nil, wrapError(err)
	}
	assignment, err := pgx.CollectExactlyOneRow(rows, scanAuthzAssignment)
	if err != nil {
		return nil, wrapError(err)
	}
	return assignment, nil
}

// ListClaimedProjectIDs implements [service.AuthzAssignmentStatements].
func (s authzAssignmentStatements) ListClaimedProjectIDs(ctx context.Context, afterID string, limit uint32) ([]string, error) {
	if limit == 0 {
		limit = 500
	}
	rows, err := s.client.Query(ctx, listClaimedProjectIDsStmt, afterID, int64(limit))
	if err != nil {
		return nil, wrapError(err)
	}
	ids, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (string, error) {
		var id string
		err := row.Scan(&id)
		return id, err
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return ids, nil
}

func scanAuthzAssignment(row pgx.CollectableRow) (*domain.AuthzAssignment, error) {
	a := new(domain.AuthzAssignment)
	if err := row.Scan(
		&a.ID, &a.ProjectID, &a.CatalogID,
		&a.PrincipalType, &a.PrincipalID, &a.ObjectType, &a.Relation,
		&a.ScopeKind, &a.ScopeTeamID, &a.ScopeResourceID,
		&a.GrantorType, &a.GrantorID, &a.DelegationID,
		&a.ExpiresAt, &a.RevokedAt, &a.CreatedAt, &a.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return a, nil
}

var authzAssignmentSchema = database.NewSchema(map[domain.AuthzAssignmentField]database.FieldBinding[domain.AuthzAssignment]{
	domain.AuthzAssignmentFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(a *domain.AuthzAssignment) any { return a.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.AuthzAssignmentFieldID: {
		SQLName:  "id",
		Accessor: func(a *domain.AuthzAssignment) any { return a.ID },
		Coerce:   database.CoerceString,
	},
	domain.AuthzAssignmentFieldPrincipalType: {
		SQLName:  "principal_type",
		Accessor: func(a *domain.AuthzAssignment) any { return a.PrincipalType.String() },
		Coerce:   database.CoerceString,
	},
	domain.AuthzAssignmentFieldPrincipalID: {
		SQLName:  "principal_id",
		Accessor: func(a *domain.AuthzAssignment) any { return a.PrincipalID },
		Coerce:   database.CoerceString,
	},
	domain.AuthzAssignmentFieldRelation: {
		SQLName:  "relation",
		Accessor: func(a *domain.AuthzAssignment) any { return a.Relation },
		Coerce:   database.CoerceString,
	},
	domain.AuthzAssignmentFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(a *domain.AuthzAssignment) any { return a.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.AuthzAssignmentFieldExpiresAt: {
		SQLName:  "expires_at",
		Accessor: func(a *domain.AuthzAssignment) any { return database.NullableValue(a.ExpiresAt) },
		Coerce:   database.CoerceTime,
		Nullable: true,
	},
})

var _ service.AuthzAssignmentStatements = (*authzAssignmentStatements)(nil)
