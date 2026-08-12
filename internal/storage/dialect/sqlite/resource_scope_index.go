package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	upsertResourceScopeStmt = `
INSERT INTO resource_scope_index (resource_id, resource_kind, project_id, team_id, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (resource_kind, project_id, resource_id) DO UPDATE SET
    team_id = excluded.team_id,
    updated_at = excluded.updated_at
RETURNING resource_id, resource_kind, project_id, team_id, created_at, updated_at`

	getResourceScopeStmt = `
SELECT resource_id, resource_kind, project_id, team_id, created_at, updated_at
FROM resource_scope_index
WHERE resource_id = ?`

	getResourceScopeInProjectStmt = `
SELECT resource_id, resource_kind, project_id, team_id, created_at, updated_at
FROM resource_scope_index
WHERE resource_kind = ? AND project_id = ? AND resource_id = ?`

	deleteResourceScopeStmt = `DELETE FROM resource_scope_index WHERE resource_kind = ? AND project_id = ? AND resource_id = ?`
)

type resourceScopeStatements struct{ statement }

func newResourceScopeStatements(client queryExecutor) resourceScopeStatements {
	return resourceScopeStatements{statement: statement{client: client}}
}

// UpsertResourceScope implements [service.ResourceScopeStatements].
func (s resourceScopeStatements) UpsertResourceScope(ctx context.Context, scope *domain.ResourceScope) error {
	now := nowUnixNano()
	var createdNano, updatedNano int64
	err := s.client.QueryRow(ctx, upsertResourceScopeStmt,
		scope.ResourceID, scope.ResourceKind.String(), scope.ProjectID, scope.TeamID, now, now,
	).Scan(&scope.ResourceID, &scope.ResourceKind, &scope.ProjectID, &scope.TeamID, &createdNano, &updatedNano)
	if err != nil {
		return wrapError(err)
	}
	scope.CreatedAt = timeFromUnixNano(createdNano)
	scope.UpdatedAt = timeFromUnixNano(updatedNano)
	return nil
}

// GetResourceScope implements [service.ResourceScopeStatements].
func (s resourceScopeStatements) GetResourceScope(ctx context.Context, resourceID string) (*domain.ResourceScope, error) {
	rows, err := s.client.Query(ctx, getResourceScopeStmt, resourceID)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	scope, err := collectExactlyOneRow(rows, scanResourceScope)
	if err != nil {
		return nil, wrapError(err)
	}
	return scope, nil
}

// GetResourceScopeInProject implements [service.ResourceScopeStatements].
func (s resourceScopeStatements) GetResourceScopeInProject(ctx context.Context, kind domain.ResourceKind, projectID, resourceID string) (*domain.ResourceScope, error) {
	rows, err := s.client.Query(ctx, getResourceScopeInProjectStmt, kind.String(), projectID, resourceID)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	scope, err := collectExactlyOneRow(rows, scanResourceScope)
	if err != nil {
		return nil, wrapError(err)
	}
	return scope, nil
}

// DeleteResourceScope implements [service.ResourceScopeStatements].
func (s resourceScopeStatements) DeleteResourceScope(ctx context.Context, kind domain.ResourceKind, projectID, resourceID string) error {
	_, err := s.client.Exec(ctx, deleteResourceScopeStmt, kind.String(), projectID, resourceID)
	return wrapError(err)
}

func scanResourceScope(rows *sql.Rows) (*domain.ResourceScope, error) {
	scope := new(domain.ResourceScope)
	var createdNano, updatedNano int64
	if err := rows.Scan(
		&scope.ResourceID, &scope.ResourceKind, &scope.ProjectID, &scope.TeamID,
		&createdNano, &updatedNano,
	); err != nil {
		return nil, err
	}
	scope.CreatedAt = timeFromUnixNano(createdNano)
	scope.UpdatedAt = timeFromUnixNano(updatedNano)
	return scope, nil
}

var _ service.ResourceScopeStatements = (*resourceScopeStatements)(nil)
