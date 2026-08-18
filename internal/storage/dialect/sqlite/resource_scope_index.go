package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	upsertResourceScopeStmt = `
INSERT INTO resource_scope_index (resource_id, resource_kind, project_id, team_id, team_project_id, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (resource_kind, project_id, resource_id) DO UPDATE SET
    team_id = excluded.team_id,
    team_project_id = excluded.team_project_id,
    updated_at = excluded.updated_at
RETURNING resource_id, resource_kind, project_id, team_id, team_project_id, created_at, updated_at`

	getResourceScopeStmt = `
SELECT resource_id, resource_kind, project_id, team_id, team_project_id, created_at, updated_at
FROM resource_scope_index
WHERE resource_id = ?`

	getResourceScopeInProjectStmt = `
SELECT resource_id, resource_kind, project_id, team_id, team_project_id, created_at, updated_at
FROM resource_scope_index
WHERE resource_kind = ? AND project_id = ? AND resource_id = ?`

	getResourceScopeByIDInProjectStmt = `
SELECT resource_id, resource_kind, project_id, team_id, team_project_id, created_at, updated_at
FROM resource_scope_index
WHERE project_id = ? AND resource_id = ?`

	existsResourceScopeElsewhereStmt = `
SELECT EXISTS (
    SELECT 1 FROM resource_scope_index
    WHERE resource_kind = ? AND resource_id = ? AND project_id <> ?
)`

	deleteResourceScopeStmt = `DELETE FROM resource_scope_index WHERE resource_kind = ? AND project_id = ? AND resource_id = ?`

	listClaimedProjectIDsStmt = `
SELECT project_id FROM resource_scope_index
WHERE resource_kind = ?
  AND team_id IS NOT NULL AND team_id <> ''
  AND (? = '' OR project_id > ?)
ORDER BY project_id
LIMIT ?`
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
		scope.ResourceID, scope.ResourceKind.String(), scope.ProjectID, scope.TeamID, scope.TeamProjectID, now, now,
	).Scan(&scope.ResourceID, &scope.ResourceKind, &scope.ProjectID, &scope.TeamID, &scope.TeamProjectID, &createdNano, &updatedNano)
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

// GetResourceScopeByIDInProject implements [service.ResourceScopeStatements].
func (s resourceScopeStatements) GetResourceScopeByIDInProject(ctx context.Context, projectID, resourceID string) (*domain.ResourceScope, error) {
	rows, err := s.client.Query(ctx, getResourceScopeByIDInProjectStmt, projectID, resourceID)
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

// ExistsResourceScopeElsewhere implements [service.ResourceScopeStatements].
func (s resourceScopeStatements) ExistsResourceScopeElsewhere(ctx context.Context, kind domain.ResourceKind, resourceID, excludeProjectID string) (bool, error) {
	var exists bool
	if err := s.client.QueryRow(ctx, existsResourceScopeElsewhereStmt, kind.String(), resourceID, excludeProjectID).Scan(&exists); err != nil {
		return false, wrapError(err)
	}
	return exists, nil
}

// DeleteResourceScope implements [service.ResourceScopeStatements].
func (s resourceScopeStatements) DeleteResourceScope(ctx context.Context, kind domain.ResourceKind, projectID, resourceID string) error {
	_, err := s.client.Exec(ctx, deleteResourceScopeStmt, kind.String(), projectID, resourceID)
	return wrapError(err)
}

// ListClaimedProjectIDs implements [service.ResourceScopeStatements].
func (s resourceScopeStatements) ListClaimedProjectIDs(ctx context.Context, afterID string, limit uint32) ([]string, error) {
	if limit == 0 {
		limit = 500
	}
	rows, err := s.client.Query(ctx, listClaimedProjectIDsStmt, domain.ResourceKindProject.String(), afterID, afterID, int64(limit))
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, wrapError(err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, wrapError(err)
	}
	return ids, nil
}

func scanResourceScope(rows *sql.Rows) (*domain.ResourceScope, error) {
	scope := new(domain.ResourceScope)
	var createdNano, updatedNano int64
	if err := rows.Scan(
		&scope.ResourceID, &scope.ResourceKind, &scope.ProjectID, &scope.TeamID,
		&scope.TeamProjectID, &createdNano, &updatedNano,
	); err != nil {
		return nil, err
	}
	scope.CreatedAt = timeFromUnixNano(createdNano)
	scope.UpdatedAt = timeFromUnixNano(updatedNano)
	return scope, nil
}

var _ service.ResourceScopeStatements = (*resourceScopeStatements)(nil)
