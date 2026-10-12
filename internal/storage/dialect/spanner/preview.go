package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/preview"
)

const (
	previewQuery      = `SELECT project_id, origin, expires_at, created_at FROM previews`
	deletePreviewStmt = `DELETE FROM previews WHERE project_id = @p1 AND origin = @p2`
	// See the postgres statement.
	deleteExpiredPreviewStmt = deletePreviewStmt + ` AND expires_at <= @p3`
)

var previewColumns = []string{"project_id", "origin", "expires_at", "created_at"}

type previewStatements struct{ statement }

func newPreviewStatements(db queryExecutor) previewStatements {
	return previewStatements{statement: statement{db: db}}
}

// GetPreview implements [service.PreviewStatements].
func (ps previewStatements) GetPreview(ctx context.Context, projectID, origin string) (*domain.Preview, error) {
	row, err := ps.db.ReadRow(ctx, previewTable, spanner.Key{projectID, origin}, previewColumns)
	if err != nil {
		return nil, err
	}
	return scanPreview(row)
}

// ListPreviews implements [service.PreviewStatements].
func (ps previewStatements) ListPreviews(ctx context.Context, filter *database.ListOptions[domain.PreviewField]) (*database.ListResult[*domain.Preview], error) {
	items, nextCursor, err := pagination.Page(filter.Pagination, preview.Schema, func(limit uint32) ([]*domain.Preview, error) {
		filter := filter.WithLimit(limit)
		var compiler statementCompiler
		// See the postgres statement for why there is no resource-scope
		// predicate.
		if err := compileList(ctx, &compiler, previewQuery, filter, preview.Schema, "", ""); err != nil {
			return nil, err
		}
		var items []*domain.Preview
		if err := ps.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
			var err error
			items, err = collectRows(iter, scanPreview)
			return err
		}); err != nil {
			return nil, err
		}
		return items, nil
	})
	if err != nil {
		return nil, err
	}
	return &database.ListResult[*domain.Preview]{Items: items, NextCursor: nextCursor}, nil
}

// DeletePreview implements [service.PreviewStatements].
func (ps previewStatements) DeletePreview(ctx context.Context, projectID, origin string) (bool, error) {
	affected, err := ps.db.Update(ctx, buildStatement(deletePreviewStmt, projectID, origin).statement())
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

// DeleteExpiredPreview implements [service.PreviewStatements].
func (ps previewStatements) DeleteExpiredPreview(ctx context.Context, projectID, origin string, now time.Time) (bool, error) {
	affected, err := ps.db.Update(ctx, buildStatement(deleteExpiredPreviewStmt, projectID, origin, now).statement())
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

func scanPreview(row *spanner.Row) (*domain.Preview, error) {
	var entity domain.Preview
	if err := row.Columns(&entity.ProjectID, &entity.Origin, &entity.ExpiresAt, &entity.CreatedAt); err != nil {
		return nil, err
	}
	entity.ExpiresAt = entity.ExpiresAt.UTC()
	entity.CreatedAt = entity.CreatedAt.UTC()
	return &entity, nil
}

var _ service.PreviewStatements = (*previewStatements)(nil)
