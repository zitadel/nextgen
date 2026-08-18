package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	upsertResourceScopeStmt = `
INSERT INTO zitadel_nextgen.resource_scope_index (resource_id, resource_kind, project_id, team_id, team_project_id)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (resource_kind, project_id, resource_id) DO UPDATE SET
    team_id = EXCLUDED.team_id,
    team_project_id = EXCLUDED.team_project_id,
    updated_at = now()
RETURNING resource_id, resource_kind, project_id, team_id, team_project_id, created_at, updated_at`

	getResourceScopeStmt = `
SELECT resource_id, resource_kind, project_id, team_id, team_project_id, created_at, updated_at
FROM zitadel_nextgen.resource_scope_index
WHERE resource_id = $1`

	getResourceScopeInProjectStmt = `
SELECT resource_id, resource_kind, project_id, team_id, team_project_id, created_at, updated_at
FROM zitadel_nextgen.resource_scope_index
WHERE resource_kind = $1 AND project_id = $2 AND resource_id = $3`

	getResourceScopeByIDInProjectStmt = `
SELECT resource_id, resource_kind, project_id, team_id, team_project_id, created_at, updated_at
FROM zitadel_nextgen.resource_scope_index
WHERE project_id = $1 AND resource_id = $2`

	existsResourceScopeElsewhereStmt = `
SELECT EXISTS (
    SELECT 1 FROM zitadel_nextgen.resource_scope_index
    WHERE resource_kind = $1 AND resource_id = $2 AND project_id <> $3
)`

	deleteResourceScopeStmt = `DELETE FROM zitadel_nextgen.resource_scope_index WHERE resource_kind = $1 AND project_id = $2 AND resource_id = $3`

	listClaimedProjectIDsStmt = `
SELECT project_id FROM zitadel_nextgen.resource_scope_index
WHERE resource_kind = $1
  AND team_id IS NOT NULL AND team_id <> ''
  AND ($2 = '' OR project_id > $2)
ORDER BY project_id
LIMIT $3`
)

type resourceScopeStatements struct{ statement }

func newResourceScopeStatements(client queryExecutor) resourceScopeStatements {
	return resourceScopeStatements{
		statement: statement{
			client: client,
		},
	}
}

// UpsertResourceScope implements [service.ResourceScopeStatements].
func (s resourceScopeStatements) UpsertResourceScope(ctx context.Context, scope *domain.ResourceScope) error {
	return wrapError(s.client.QueryRow(ctx, upsertResourceScopeStmt,
		scope.ResourceID, scope.ResourceKind.String(), scope.ProjectID, scope.TeamID, scope.TeamProjectID,
	).Scan(&scope.ResourceID, &scope.ResourceKind, &scope.ProjectID, &scope.TeamID, &scope.TeamProjectID, &scope.CreatedAt, &scope.UpdatedAt))
}

// GetResourceScope implements [service.ResourceScopeStatements].
func (s resourceScopeStatements) GetResourceScope(ctx context.Context, resourceID string) (*domain.ResourceScope, error) {
	rows, err := s.client.Query(ctx, getResourceScopeStmt, resourceID)
	if err != nil {
		return nil, wrapError(err)
	}
	scope, err := pgx.CollectExactlyOneRow(rows, scanResourceScope)
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
	scope, err := pgx.CollectExactlyOneRow(rows, scanResourceScope)
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
	scope, err := pgx.CollectExactlyOneRow(rows, scanResourceScope)
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
	rows, err := s.client.Query(ctx, listClaimedProjectIDsStmt, domain.ResourceKindProject.String(), afterID, int64(limit))
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

func scanResourceScope(row pgx.CollectableRow) (*domain.ResourceScope, error) {
	scope := new(domain.ResourceScope)
	if err := row.Scan(
		&scope.ResourceID, &scope.ResourceKind, &scope.ProjectID, &scope.TeamID,
		&scope.TeamProjectID, &scope.CreatedAt, &scope.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return scope, nil
}

var _ service.ResourceScopeStatements = (*resourceScopeStatements)(nil)
