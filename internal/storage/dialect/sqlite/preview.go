package sqlite

import (
	"context"
	"database/sql"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	// The conflict target is the primary key, so deploying to a live URL
	// again renews it rather than adding a second row; created_at keeps the
	// original stamp.
	upsertPreviewStmt = `INSERT INTO previews (project_id, origin, expires_at, created_at)` +
		` VALUES (?, ?, ?, ?)` +
		` ON CONFLICT (project_id, origin) DO UPDATE SET expires_at = excluded.expires_at` +
		` RETURNING created_at`
	previewQuery          = `SELECT project_id, origin, expires_at, created_at FROM previews`
	getPreviewStmt        = previewQuery + ` WHERE project_id = ? AND origin = ?`
	listPreviewsStmt      = previewQuery + ` WHERE project_id = ? ORDER BY origin`
	deletePreviewStmt     = `DELETE FROM previews WHERE project_id = ? AND origin = ?`
	deleteExpiredPreviews = `DELETE FROM previews WHERE expires_at <= ?`
)

type previewStatements struct{ statement }

func newPreviewStatements(client queryExecutor) previewStatements {
	return previewStatements{statement: statement{client: client}}
}

// UpsertPreview implements [service.PreviewStatements].
func (os previewStatements) UpsertPreview(ctx context.Context, entity *domain.Preview) error {
	var createdNano int64
	if err := os.client.QueryRow(ctx, upsertPreviewStmt,
		entity.ProjectID, entity.Origin, entity.ExpiresAt.UTC().UnixNano(), nowUnixNano(),
	).Scan(&createdNano); err != nil {
		return wrapError(err)
	}
	entity.CreatedAt = timeFromUnixNano(createdNano)
	entity.ExpiresAt = entity.ExpiresAt.UTC()
	return nil
}

// GetOrigin implements [service.PreviewStatements].
func (os previewStatements) GetPreview(ctx context.Context, projectID, origin string) (*domain.Preview, error) {
	rows, err := os.client.Query(ctx, getPreviewStmt, projectID, origin)
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
func (os previewStatements) ListPreviews(ctx context.Context, projectID string) ([]*domain.Preview, error) {
	rows, err := os.client.Query(ctx, listPreviewsStmt, projectID)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	items, err := collectRows(rows, scanPreview)
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

// DeletePreview implements [service.PreviewStatements].
func (os previewStatements) DeletePreview(ctx context.Context, projectID, origin string) error {
	n, err := execAffected(ctx, os.client, deletePreviewStmt, projectID, origin)
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// DeleteExpiredPreviews implements [service.PreviewStatements].
func (os previewStatements) DeleteExpiredPreviews(ctx context.Context, now time.Time) (int64, error) {
	return execAffected(ctx, os.client, deleteExpiredPreviews, now.UTC().UnixNano())
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
