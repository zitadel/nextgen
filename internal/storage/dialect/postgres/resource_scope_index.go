package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	upsertResourceScopeStmt = `
INSERT INTO zitadel_nextgen.resource_scope_index (resource_id, resource_kind, project_id, team_id)
VALUES ($1, $2, $3, $4)
ON CONFLICT (resource_kind, project_id, resource_id) DO UPDATE SET
    team_id = EXCLUDED.team_id,
    updated_at = now()
RETURNING resource_id, resource_kind, project_id, team_id, created_at, updated_at`

	getResourceScopeStmt = `
SELECT resource_id, resource_kind, project_id, team_id, created_at, updated_at
FROM zitadel_nextgen.resource_scope_index
WHERE resource_id = $1`

	getResourceScopeInProjectStmt = `
SELECT resource_id, resource_kind, project_id, team_id, created_at, updated_at
FROM zitadel_nextgen.resource_scope_index
WHERE resource_kind = $1 AND project_id = $2 AND resource_id = $3`

	deleteResourceScopeStmt = `DELETE FROM zitadel_nextgen.resource_scope_index WHERE resource_kind = $1 AND project_id = $2 AND resource_id = $3`
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
		scope.ResourceID, scope.ResourceKind.String(), scope.ProjectID, scope.TeamID,
	).Scan(&scope.ResourceID, &scope.ResourceKind, &scope.ProjectID, &scope.TeamID, &scope.CreatedAt, &scope.UpdatedAt))
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

// DeleteResourceScope implements [service.ResourceScopeStatements].
func (s resourceScopeStatements) DeleteResourceScope(ctx context.Context, kind domain.ResourceKind, projectID, resourceID string) error {
	_, err := s.client.Exec(ctx, deleteResourceScopeStmt, kind.String(), projectID, resourceID)
	return wrapError(err)
}

func scanResourceScope(row pgx.CollectableRow) (*domain.ResourceScope, error) {
	scope := new(domain.ResourceScope)
	if err := row.Scan(
		&scope.ResourceID, &scope.ResourceKind, &scope.ProjectID, &scope.TeamID,
		&scope.CreatedAt, &scope.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return scope, nil
}

var _ service.ResourceScopeStatements = (*resourceScopeStatements)(nil)
