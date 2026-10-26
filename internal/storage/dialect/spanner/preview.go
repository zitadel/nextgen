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
	existingPreviewsQuery    = `SELECT origin FROM previews WHERE project_id = @p1 AND origin IN UNNEST(@p2)`
	previewQuery             = `SELECT project_id, origin, expires_at, created_at FROM previews`
	deletePreviewStmt        = `DELETE FROM previews WHERE project_id = @p1 AND origin = @p2`
	deleteLivePreviewStmt    = deletePreviewStmt + ` AND expires_at > @p3`
	deleteExpiredPreviewStmt = deletePreviewStmt + ` AND expires_at <= @p3`
)

var previewColumns = []string{"project_id", "origin", "expires_at", "created_at"}

type previewStatements struct{ statement }

func newPreviewStatements(db queryExecutor) previewStatements {
	return previewStatements{statement: statement{db: db}}
}

// UpsertPreviews implements [service.PreviewStatements].
func (ps previewStatements) UpsertPreviews(ctx context.Context, projectID string, origins []string, expiresAt, createdAt time.Time) error {
	return withTransaction(ctx, ps.db, func(ctx context.Context, tx queryExecutor) error {
		present := make(map[string]bool, len(origins))
		if err := tx.Query(ctx, buildStatement(existingPreviewsQuery, projectID, origins).statement(), func(iter *spanner.RowIterator) error {
			_, err := collectRows(iter, func(row *spanner.Row) (struct{}, error) {
				var origin string
				if err := row.Columns(&origin); err != nil {
					return struct{}{}, err
				}
				present[origin] = true
				return struct{}{}, nil
			})
			return err
		}); err != nil {
			return err
		}
		mutations := make([]*spanner.Mutation, 0, len(origins))
		for _, origin := range origins {
			if present[origin] {
				mutations = append(mutations, spanner.Update(previewTable,
					[]string{"project_id", "origin", "expires_at"}, []any{projectID, origin, expiresAt}))
				continue
			}
			mutations = append(mutations, spanner.Insert(previewTable, previewColumns,
				[]any{projectID, origin, expiresAt, createdAt}))
		}
		return tx.BufferWrite(ctx, mutations)
	})
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
		// No resource-scope predicate: a preview has no id of its own.
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

// DeleteLivePreview implements [service.PreviewStatements].
func (ps previewStatements) DeleteLivePreview(ctx context.Context, projectID, origin string, now time.Time) (bool, error) {
	return ps.delete(ctx, buildStatement(deleteLivePreviewStmt, projectID, origin, now).statement())
}

// DeleteExpiredPreview implements [service.PreviewStatements].
func (ps previewStatements) DeleteExpiredPreview(ctx context.Context, projectID, origin string, now time.Time) (bool, error) {
	return ps.delete(ctx, buildStatement(deleteExpiredPreviewStmt, projectID, origin, now).statement())
}

func (ps previewStatements) delete(ctx context.Context, stmt spanner.Statement) (bool, error) {
	affected, err := ps.db.Update(ctx, stmt)
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
