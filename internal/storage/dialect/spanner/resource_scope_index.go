package spanner

import (
	"context"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	resourceScopeIndexTable = "resource_scope_index"

	upsertResourceScopeStmt = `
INSERT INTO resource_scope_index (resource_id, resource_kind, project_id, team_id)
VALUES (@p1, @p2, @p3, @p4)
ON CONFLICT (resource_kind, project_id, resource_id) DO UPDATE SET
    team_id = EXCLUDED.team_id,
    updated_at = CURRENT_TIMESTAMP()
THEN RETURN resource_id, resource_kind, project_id, team_id, created_at, updated_at`

	getResourceScopeStmt = `
SELECT resource_id, resource_kind, project_id, team_id, created_at, updated_at
FROM resource_scope_index
WHERE resource_id = @p1`

	getResourceScopeByIDInProjectStmt = `
SELECT resource_id, resource_kind, project_id, team_id, created_at, updated_at
FROM resource_scope_index
WHERE project_id = @p1 AND resource_id = @p2`

	existsResourceScopeElsewhereStmt = `
SELECT EXISTS (
    SELECT 1 FROM resource_scope_index
    WHERE resource_kind = @p1 AND resource_id = @p2 AND project_id <> @p3
)`

	deleteResourceScopeStmt = `DELETE FROM resource_scope_index WHERE resource_kind = @p1 AND project_id = @p2 AND resource_id = @p3`

	listClaimedProjectIDsStmt = `
SELECT project_id FROM resource_scope_index
WHERE resource_kind = @p1
  AND team_id IS NOT NULL AND team_id <> ''
  AND (@p2 = '' OR project_id > @p2)
ORDER BY project_id
LIMIT @p3`
)

var resourceScopeColumns = []string{
	"resource_id", "resource_kind", "project_id", "team_id", "created_at", "updated_at",
}

type resourceScopeStatements struct{ statement }

func newResourceScopeStatements(db queryExecutor) resourceScopeStatements {
	return resourceScopeStatements{
		statement: statement{
			db: db,
		},
	}
}

// UpsertResourceScope implements [service.ResourceScopeStatements].
func (s resourceScopeStatements) UpsertResourceScope(ctx context.Context, scope *domain.ResourceScope) error {
	stmt := buildStatement(upsertResourceScopeStmt,
		scope.ResourceID, scope.ResourceKind.String(), scope.ProjectID, spannerNullString(scope.TeamID),
	).statement()
	return s.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		updated, err := collectOneRow(iter, scanResourceScope)
		if err != nil {
			return err
		}
		*scope = *updated
		return nil
	})
}

// GetResourceScope implements [service.ResourceScopeStatements].
func (s resourceScopeStatements) GetResourceScope(ctx context.Context, resourceID string) (*domain.ResourceScope, error) {
	var scope *domain.ResourceScope
	err := s.db.Query(ctx, buildStatement(getResourceScopeStmt, resourceID).statement(), func(iter *spanner.RowIterator) error {
		updated, err := collectOneRow(iter, scanResourceScope)
		if err != nil {
			return err
		}
		scope = updated
		return nil
	})
	if err != nil {
		return nil, err
	}
	return scope, nil
}

// GetResourceScopeInProject implements [service.ResourceScopeStatements].
func (s resourceScopeStatements) GetResourceScopeInProject(ctx context.Context, kind domain.ResourceKind, projectID, resourceID string) (*domain.ResourceScope, error) {
	row, err := s.db.ReadRow(ctx, resourceScopeIndexTable, spanner.Key{kind.String(), projectID, resourceID}, resourceScopeColumns)
	if err != nil {
		return nil, err
	}
	return scanResourceScope(row)
}

// GetResourceScopeByIDInProject implements [service.ResourceScopeStatements].
func (s resourceScopeStatements) GetResourceScopeByIDInProject(ctx context.Context, projectID, resourceID string) (*domain.ResourceScope, error) {
	var scope *domain.ResourceScope
	err := s.db.Query(ctx, buildStatement(getResourceScopeByIDInProjectStmt, projectID, resourceID).statement(), func(iter *spanner.RowIterator) error {
		updated, err := collectOneRow(iter, scanResourceScope)
		if err != nil {
			return err
		}
		scope = updated
		return nil
	})
	if err != nil {
		return nil, err
	}
	return scope, nil
}

// ExistsResourceScopeElsewhere implements [service.ResourceScopeStatements].
func (s resourceScopeStatements) ExistsResourceScopeElsewhere(ctx context.Context, kind domain.ResourceKind, resourceID, excludeProjectID string) (bool, error) {
	var exists bool
	err := s.db.Query(ctx, buildStatement(existsResourceScopeElsewhereStmt, kind.String(), resourceID, excludeProjectID).statement(), func(iter *spanner.RowIterator) error {
		row, err := iter.Next()
		if err != nil {
			return err
		}
		return row.Columns(&exists)
	})
	if err != nil {
		return false, err
	}
	return exists, nil
}

// DeleteResourceScope implements [service.ResourceScopeStatements].
func (s resourceScopeStatements) DeleteResourceScope(ctx context.Context, kind domain.ResourceKind, projectID, resourceID string) error {
	_, err := s.db.Update(ctx, buildStatement(deleteResourceScopeStmt, kind.String(), projectID, resourceID).statement())
	return err
}

// ListClaimedProjectIDs implements [service.ResourceScopeStatements].
func (s resourceScopeStatements) ListClaimedProjectIDs(ctx context.Context, afterID string, limit uint32) ([]string, error) {
	if limit == 0 {
		limit = 500
	}
	var ids []string
	err := s.db.Query(ctx, buildStatement(listClaimedProjectIDsStmt, domain.ResourceKindProject.String(), afterID, int64(limit)).statement(), func(iter *spanner.RowIterator) error {
		var err error
		ids, err = collectRows(iter, func(row *spanner.Row) (string, error) {
			var id string
			if err := row.Columns(&id); err != nil {
				return "", err
			}
			return id, nil
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	return ids, nil
}

func scanResourceScope(row *spanner.Row) (*domain.ResourceScope, error) {
	scope := new(domain.ResourceScope)
	if err := row.Columns(
		&scope.ResourceID, &scope.ResourceKind, &scope.ProjectID, &scope.TeamID,
		&scope.CreatedAt, &scope.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return scope, nil
}

var _ service.ResourceScopeStatements = (*resourceScopeStatements)(nil)
