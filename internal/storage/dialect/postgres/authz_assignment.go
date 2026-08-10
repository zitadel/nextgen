package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
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

// RevokeAuthzAssignment implements [service.AuthzAssignmentStatements].
func (s authzAssignmentStatements) RevokeAuthzAssignment(ctx context.Context, projectID, id string) error {
	var revokedAt, updatedAt time.Time
	return wrapError(s.client.QueryRow(ctx, revokeAuthzAssignmentStmt, projectID, id).Scan(&revokedAt, &updatedAt))
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

var _ service.AuthzAssignmentStatements = (*authzAssignmentStatements)(nil)
