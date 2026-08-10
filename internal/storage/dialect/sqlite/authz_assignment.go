package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	createAuthzAssignmentStmt = `
INSERT INTO authz_assignments (
    id, project_id, catalog_id,
    principal_type, principal_id, object_type, relation,
    scope_kind, scope_team_id, scope_resource_id,
    grantor_type, grantor_id, delegation_id,
    expires_at, revoked_at, created_at, updated_at
) VALUES (
    ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?,
    ?, ?, ?,
    ?, ?, ?, ?
) RETURNING created_at, updated_at`

	getAuthzAssignmentStmt = `
SELECT id, project_id, catalog_id,
       principal_type, principal_id, object_type, relation,
       scope_kind, scope_team_id, scope_resource_id,
       grantor_type, grantor_id, delegation_id,
       expires_at, revoked_at, created_at, updated_at
FROM authz_assignments
WHERE project_id = ? AND id = ?`

	listAuthzAssignmentsStmt = `
SELECT id, project_id, catalog_id,
       principal_type, principal_id, object_type, relation,
       scope_kind, scope_team_id, scope_resource_id,
       grantor_type, grantor_id, delegation_id,
       expires_at, revoked_at, created_at, updated_at
FROM authz_assignments
WHERE project_id = ? AND principal_type = ? AND principal_id = ?
  AND (? OR revoked_at IS NULL)
ORDER BY created_at, id`

	revokeAuthzAssignmentStmt = `
UPDATE authz_assignments
SET revoked_at = ?, updated_at = ?
WHERE project_id = ? AND id = ? AND revoked_at IS NULL
RETURNING revoked_at, updated_at`
)

type authzAssignmentStatements struct{ statement }

func newAuthzAssignmentStatements(client queryExecutor) authzAssignmentStatements {
	return authzAssignmentStatements{statement: statement{client: client}}
}

// CreateAuthzAssignment implements [service.AuthzAssignmentStatements].
func (s authzAssignmentStatements) CreateAuthzAssignment(ctx context.Context, a *domain.AuthzAssignment) error {
	if err := ensureManagedID(&a.ID, domain.PrefixAuthzAssignment); err != nil {
		return err
	}
	now := nowUnixNano()
	var createdNano, updatedNano int64
	err := s.client.QueryRow(ctx, createAuthzAssignmentStmt,
		a.ID, a.ProjectID, a.CatalogID,
		a.PrincipalType.String(), a.PrincipalID, a.ObjectType, a.Relation,
		a.ScopeKind.String(), a.ScopeTeamID, a.ScopeResourceID,
		a.GrantorType, a.GrantorID, a.DelegationID,
		nullUnixNano(a.ExpiresAt), nullUnixNano(a.RevokedAt), now, now,
	).Scan(&createdNano, &updatedNano)
	if err != nil {
		return wrapError(err)
	}
	a.CreatedAt = timeFromUnixNano(createdNano)
	a.UpdatedAt = timeFromUnixNano(updatedNano)
	return nil
}

// GetAuthzAssignment implements [service.AuthzAssignmentStatements].
func (s authzAssignmentStatements) GetAuthzAssignment(ctx context.Context, projectID, id string) (*domain.AuthzAssignment, error) {
	rows, err := s.client.Query(ctx, getAuthzAssignmentStmt, projectID, id)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	assignment, err := collectExactlyOneRow(rows, scanAuthzAssignment)
	if err != nil {
		return nil, wrapError(err)
	}
	return assignment, nil
}

// ListAuthzAssignments implements [service.AuthzAssignmentStatements].
func (s authzAssignmentStatements) ListAuthzAssignments(ctx context.Context, projectID string, principalType domain.AuthzPrincipalType, principalID string, includeRevoked bool) ([]*domain.AuthzAssignment, error) {
	include := 0
	if includeRevoked {
		include = 1
	}
	rows, err := s.client.Query(ctx, listAuthzAssignmentsStmt, projectID, principalType.String(), principalID, include)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	assignments, err := collectRows(rows, scanAuthzAssignment)
	if err != nil {
		return nil, wrapError(err)
	}
	return assignments, nil
}

// RevokeAuthzAssignment implements [service.AuthzAssignmentStatements].
func (s authzAssignmentStatements) RevokeAuthzAssignment(ctx context.Context, projectID, id string) error {
	now := nowUnixNano()
	var revokedNano, updatedNano int64
	err := s.client.QueryRow(ctx, revokeAuthzAssignmentStmt, now, now, projectID, id).Scan(&revokedNano, &updatedNano)
	if err != nil {
		if err == sql.ErrNoRows {
			return database.NewNoRowFoundError(nil)
		}
		return wrapError(err)
	}
	return nil
}

func scanAuthzAssignment(rows *sql.Rows) (*domain.AuthzAssignment, error) {
	a := new(domain.AuthzAssignment)
	var (
		expiresNano, revokedNano sql.NullInt64
		createdNano, updatedNano int64
	)
	if err := rows.Scan(
		&a.ID, &a.ProjectID, &a.CatalogID,
		&a.PrincipalType, &a.PrincipalID, &a.ObjectType, &a.Relation,
		&a.ScopeKind, &a.ScopeTeamID, &a.ScopeResourceID,
		&a.GrantorType, &a.GrantorID, &a.DelegationID,
		&expiresNano, &revokedNano, &createdNano, &updatedNano,
	); err != nil {
		return nil, err
	}
	if expiresNano.Valid {
		t := timeFromUnixNano(expiresNano.Int64)
		a.ExpiresAt = &t
	}
	if revokedNano.Valid {
		t := timeFromUnixNano(revokedNano.Int64)
		a.RevokedAt = &t
	}
	a.CreatedAt = timeFromUnixNano(createdNano)
	a.UpdatedAt = timeFromUnixNano(updatedNano)
	return a, nil
}

var _ service.AuthzAssignmentStatements = (*authzAssignmentStatements)(nil)
