package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/preview"
)

const (
	upsertPreviewsStmt = `INSERT INTO zitadel_nextgen.previews (project_id, origin, expires_at, created_at)` +
		` SELECT $1, origin, $2, $3 FROM unnest($4::text[]) AS origin` +
		` ON CONFLICT (project_id, origin) DO UPDATE SET expires_at = EXCLUDED.expires_at`
	previewQuery             = `SELECT project_id, origin, expires_at, created_at FROM zitadel_nextgen.previews`
	deletePreviewStmt        = `DELETE FROM zitadel_nextgen.previews WHERE project_id = $1 AND origin = $2`
	deleteExpiredPreviewStmt = deletePreviewStmt + ` AND expires_at <= $3`
)

type previewStatements struct{ statement }

func newPreviewStatements(client queryExecutor) previewStatements {
	return previewStatements{statement: statement{client: client}}
}

// UpsertPreviews implements [service.PreviewStatements].
func (ps previewStatements) UpsertPreviews(ctx context.Context, projectID string, origins []string, expiresAt, createdAt time.Time) error {
	_, err := ps.client.Exec(ctx, upsertPreviewsStmt, projectID, expiresAt, createdAt, origins)
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
	entity, err := pgx.CollectExactlyOneRow(rows, scanPreview)
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
		items, err := pgx.CollectRows(rows, scanPreview)
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
	tag, err := ps.client.Exec(ctx, deletePreviewStmt, projectID, origin)
	if err != nil {
		return false, wrapError(err)
	}
	return tag.RowsAffected() > 0, nil
}

// DeleteExpiredPreview implements [service.PreviewStatements].
func (ps previewStatements) DeleteExpiredPreview(ctx context.Context, projectID, origin string, now time.Time) (bool, error) {
	tag, err := ps.client.Exec(ctx, deleteExpiredPreviewStmt, projectID, origin, now)
	if err != nil {
		return false, wrapError(err)
	}
	return tag.RowsAffected() > 0, nil
}

func scanPreview(row pgx.CollectableRow) (*domain.Preview, error) {
	var entity domain.Preview
	if err := row.Scan(&entity.ProjectID, &entity.Origin, &entity.ExpiresAt, &entity.CreatedAt); err != nil {
		return nil, err
	}
	entity.ExpiresAt = entity.ExpiresAt.UTC()
	entity.CreatedAt = entity.CreatedAt.UTC()
	return &entity, nil
}

var _ service.PreviewStatements = (*previewStatements)(nil)
