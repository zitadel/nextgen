package sqlite

import (
	"context"
	"database/sql"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/preview"
)

const (
	upsertPreviewsStmt = `INSERT INTO previews (project_id, origin, expires_at, created_at)` +
		` SELECT ?, value, ?, ? FROM json_each(?) WHERE true` +
		` ON CONFLICT (project_id, origin) DO UPDATE SET expires_at = excluded.expires_at`
	previewQuery             = `SELECT project_id, origin, expires_at, created_at FROM previews`
	deletePreviewStmt        = `DELETE FROM previews WHERE project_id = ? AND origin = ?`
	deleteExpiredPreviewStmt = deletePreviewStmt + ` AND expires_at <= ?`
)

type previewStatements struct{ statement }

func newPreviewStatements(client queryExecutor) previewStatements {
	return previewStatements{statement: statement{client: client}}
}

// UpsertPreviews implements [service.PreviewStatements].
func (ps previewStatements) UpsertPreviews(ctx context.Context, projectID string, origins []string, expiresAt, createdAt time.Time) error {
	encoded, err := jsonArray(origins)
	if err != nil {
		return err
	}
	_, err = ps.client.Exec(ctx, upsertPreviewsStmt, projectID, expiresAt.UnixNano(), createdAt.UnixNano(), encoded)
	return wrapError(err)
}

// GetPreview implements [service.PreviewStatements].
func (ps previewStatements) GetPreview(ctx context.Context, projectID, origin string) (*domain.Preview, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, previewQuery, &database.ListOptions[domain.PreviewField]{
		Filter: database.And(
			database.Equal(database.Col(domain.PreviewFieldProjectID), projectID),
			database.Equal(database.Col(domain.PreviewFieldOrigin), origin),
		),
	}, preview.Schema); err != nil {
		return nil, err
	}
	rows, err := ps.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	entity, err := collectExactlyOneRow(rows, scanPreview)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
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
		rows, err := ps.client.Query(ctx, compiler.String(), compiler.args...)
		if err != nil {
			return nil, wrapError(err)
		}
		defer rows.Close()
		items, err := collectRows(rows, scanPreview)
		if err != nil {
			return nil, wrapError(err)
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
	return ps.delete(ctx, deletePreviewStmt, projectID, origin)
}

// DeleteExpiredPreview implements [service.PreviewStatements].
func (ps previewStatements) DeleteExpiredPreview(ctx context.Context, projectID, origin string, now time.Time) (bool, error) {
	return ps.delete(ctx, deleteExpiredPreviewStmt, projectID, origin, now.UnixNano())
}

func (ps previewStatements) delete(ctx context.Context, query string, args ...any) (bool, error) {
	result, err := ps.client.Exec(ctx, query, args...)
	if err != nil {
		return false, wrapError(err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, wrapError(err)
	}
	return affected > 0, nil
}

func scanPreview(rows *sql.Rows) (*domain.Preview, error) {
	var (
		entity                   domain.Preview
		expiresNano, createdNano int64
	)
	if err := rows.Scan(&entity.ProjectID, &entity.Origin, &expiresNano, &createdNano); err != nil {
		return nil, err
	}
	entity.ExpiresAt = timeFromUnixNano(expiresNano)
	entity.CreatedAt = timeFromUnixNano(createdNano)
	return &entity, nil
}

var _ service.PreviewStatements = (*previewStatements)(nil)
