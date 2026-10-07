package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	// The conflict target is the primary key, so deploying to a live URL
	// again renews it rather than adding a second row; created_at keeps the
	// original stamp.
	upsertPreviewStmt = `INSERT INTO zitadel_nextgen.previews (project_id, origin, expires_at)` +
		` VALUES ($1, $2, $3)` +
		` ON CONFLICT (project_id, origin) DO UPDATE SET expires_at = EXCLUDED.expires_at` +
		` RETURNING created_at`
	previewQuery          = `SELECT project_id, origin, expires_at, created_at FROM zitadel_nextgen.previews`
	getPreviewStmt        = previewQuery + ` WHERE project_id = $1 AND origin = $2`
	listPreviewsStmt      = previewQuery + ` WHERE project_id = $1 ORDER BY origin`
	deletePreviewStmt     = `DELETE FROM zitadel_nextgen.previews WHERE project_id = $1 AND origin = $2`
	deleteExpiredPreviews = `DELETE FROM zitadel_nextgen.previews WHERE expires_at <= $1`
)

type previewStatements struct{ statement }

func newPreviewStatements(client queryExecutor) previewStatements {
	return previewStatements{statement: statement{client: client}}
}

// UpsertPreview implements [service.PreviewStatements].
func (os previewStatements) UpsertPreview(ctx context.Context, entity *domain.Preview) error {
	if err := os.client.QueryRow(ctx, upsertPreviewStmt, entity.ProjectID, entity.Origin, entity.ExpiresAt).
		Scan(&entity.CreatedAt); err != nil {
		return wrapError(err)
	}
	entity.CreatedAt = entity.CreatedAt.UTC()
	entity.ExpiresAt = entity.ExpiresAt.UTC()
	return nil
}

// GetOrigin implements [service.PreviewStatements].
func (os previewStatements) GetPreview(ctx context.Context, projectID, origin string) (*domain.Preview, error) {
	rows, err := os.client.Query(ctx, getPreviewStmt, projectID, origin)
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
func (os previewStatements) ListPreviews(ctx context.Context, projectID string) ([]*domain.Preview, error) {
	rows, err := os.client.Query(ctx, listPreviewsStmt, projectID)
	if err != nil {
		return nil, wrapError(err)
	}
	items, err := pgx.CollectRows(rows, scanPreview)
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

// DeletePreview implements [service.PreviewStatements].
func (os previewStatements) DeletePreview(ctx context.Context, projectID, origin string) error {
	tag, err := os.client.Exec(ctx, deletePreviewStmt, projectID, origin)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// DeleteExpiredPreviews implements [service.PreviewStatements].
func (os previewStatements) DeleteExpiredPreviews(ctx context.Context, now time.Time) (int64, error) {
	tag, err := os.client.Exec(ctx, deleteExpiredPreviews, now)
	if err != nil {
		return 0, wrapError(err)
	}
	return tag.RowsAffected(), nil
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
