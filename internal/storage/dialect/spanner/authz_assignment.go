package spanner

import (
	"context"
	"strings"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

const (
	authzAssignmentsTable = "authz_assignments"

	createAuthzAssignmentStmt = `
INSERT INTO authz_assignments (
    id, project_id, catalog_id,
    principal_type, principal_id, object_type, relation,
    scope_kind, scope_team_id, scope_resource_id,
    grantor_type, grantor_id, delegation_id,
    expires_at, revoked_at, active_unique_key
) VALUES (
    @p1, @p2, @p3,
    @p4, @p5, @p6, @p7,
    @p8, @p9, @p10,
    @p11, @p12, @p13,
    @p14, @p15, @p16
) THEN RETURN created_at, updated_at`

	listAuthzAssignmentsStmt = `
SELECT id, project_id, catalog_id,
       principal_type, principal_id, object_type, relation,
       scope_kind, scope_team_id, scope_resource_id,
       grantor_type, grantor_id, delegation_id,
       expires_at, revoked_at, created_at, updated_at
FROM authz_assignments
WHERE project_id = @p1 AND principal_type = @p2 AND principal_id = @p3
  AND (@p4 = TRUE OR revoked_at IS NULL)
ORDER BY created_at, id`

	revokeAuthzAssignmentStmt = `
UPDATE authz_assignments
SET revoked_at = CURRENT_TIMESTAMP(), updated_at = CURRENT_TIMESTAMP(), active_unique_key = NULL
WHERE project_id = @p1 AND id = @p2 AND revoked_at IS NULL
THEN RETURN revoked_at, updated_at`
)

var authzAssignmentColumns = []string{
	"id", "project_id", "catalog_id",
	"principal_type", "principal_id", "object_type", "relation",
	"scope_kind", "scope_team_id", "scope_resource_id",
	"grantor_type", "grantor_id", "delegation_id",
	"expires_at", "revoked_at", "created_at", "updated_at",
}

type authzAssignmentStatements struct{ statement }

func newAuthzAssignmentStatements(db queryExecutor) authzAssignmentStatements {
	return authzAssignmentStatements{
		statement: statement{
			db: db,
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
	stmt := buildStatement(createAuthzAssignmentStmt,
		a.ID, a.ProjectID, a.CatalogID,
		a.PrincipalType.String(), a.PrincipalID, a.ObjectType, a.Relation,
		a.ScopeKind.String(), spannerNullString(a.ScopeTeamID), spannerNullString(a.ScopeResourceID),
		spannerNullString(a.GrantorType), spannerNullString(a.GrantorID), spannerNullString(a.DelegationID),
		spannerNullTime(a.ExpiresAt), spannerNullTime(a.RevokedAt), spannerNullString(activeUniqueKey(a)),
	).statement()
	return s.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&a.CreatedAt, &a.UpdatedAt)
		})
		return err
	})
}

// GetAuthzAssignment implements [service.AuthzAssignmentStatements].
func (s authzAssignmentStatements) GetAuthzAssignment(ctx context.Context, projectID, id string) (*domain.AuthzAssignment, error) {
	row, err := s.db.ReadRow(ctx, authzAssignmentsTable, spanner.Key{projectID, id}, authzAssignmentColumns)
	if err != nil {
		return nil, err
	}
	return scanAuthzAssignment(row)
}

// ListAuthzAssignments implements [service.AuthzAssignmentStatements].
func (s authzAssignmentStatements) ListAuthzAssignments(ctx context.Context, projectID string, principalType domain.AuthzPrincipalType, principalID string, includeRevoked bool) ([]*domain.AuthzAssignment, error) {
	var assignments []*domain.AuthzAssignment
	err := s.db.Query(ctx, buildStatement(listAuthzAssignmentsStmt, projectID, principalType.String(), principalID, includeRevoked).statement(), func(iter *spanner.RowIterator) error {
		var qErr error
		assignments, qErr = collectRows(iter, scanAuthzAssignment)
		return qErr
	})
	return assignments, err
}

// RevokeAuthzAssignment implements [service.AuthzAssignmentStatements].
func (s authzAssignmentStatements) RevokeAuthzAssignment(ctx context.Context, projectID, id string) error {
	stmt := buildStatement(revokeAuthzAssignmentStmt, projectID, id).statement()
	return s.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			var revokedAt, updatedAt time.Time
			return struct{}{}, row.Columns(&revokedAt, &updatedAt)
		})
		return err
	})
}

func scanAuthzAssignment(row *spanner.Row) (*domain.AuthzAssignment, error) {
	a := new(domain.AuthzAssignment)
	if err := row.Columns(
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

// activeUniqueKey is Spanner's stand-in for Postgres's partial unique index on
// active (non-revoked, non-delegated) assignments. Returns nil when the row must
// not participate in uniqueness.
func activeUniqueKey(a *domain.AuthzAssignment) *string {
	if a.RevokedAt != nil || a.DelegationID != nil {
		return nil
	}
	scopeTeam := ""
	if a.ScopeTeamID != nil {
		scopeTeam = *a.ScopeTeamID
	}
	scopeResource := ""
	if a.ScopeResourceID != nil {
		scopeResource = *a.ScopeResourceID
	}
	key := strings.Join([]string{
		a.ProjectID, a.CatalogID, a.PrincipalType.String(), a.PrincipalID,
		a.ObjectType, a.Relation, a.ScopeKind.String(), scopeTeam, scopeResource,
	}, "\x1f")
	return &key
}

var _ service.AuthzAssignmentStatements = (*authzAssignmentStatements)(nil)
