package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	originsTable = "origins"
	// INSERT OR UPDATE keys on the primary key, so deploying to a live URL
	// again renews it rather than adding a second row. created_at is read
	// back rather than written, so the original stamp survives a renewal.
	upsertPreviewStmt = `INSERT OR UPDATE INTO previews (project_id, origin, expires_at)` +
		` VALUES (@p1, @p2, @p3) THEN RETURN created_at`
	previewQuery          = `SELECT project_id, origin, expires_at, created_at FROM previews`
	listPreviewsStmt      = previewQuery + ` WHERE project_id = @p1 ORDER BY origin`
	deletePreviewStmt     = `DELETE FROM previews WHERE project_id = @p1 AND origin = @p2`
	deleteExpiredPreviews = `DELETE FROM previews WHERE expires_at <= @p1`
)

var originColumns = []string{"project_id", "origin", "expires_at", "created_at"}

type previewStatements struct{ statement }

func newPreviewStatements(db queryExecutor) previewStatements {
	return previewStatements{statement: statement{db: db}}
}

// UpsertPreview implements [service.PreviewStatements].
func (os previewStatements) UpsertPreview(ctx context.Context, entity *domain.Preview) error {
	stmt := buildStatement(upsertPreviewStmt, entity.ProjectID, entity.Origin, entity.ExpiresAt.UTC()).statement()
	return os.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			if err := row.Columns(&entity.CreatedAt); err != nil {
				return struct{}{}, err
			}
			entity.CreatedAt = entity.CreatedAt.UTC()
			entity.ExpiresAt = entity.ExpiresAt.UTC()
			return struct{}{}, nil
		})
		return err
	})
}

// GetOrigin implements [service.PreviewStatements].
func (os previewStatements) GetPreview(ctx context.Context, projectID, origin string) (*domain.Preview, error) {
	row, err := os.db.ReadRow(ctx, originsTable, spanner.Key{projectID, origin}, originColumns)
	if err != nil {
		return nil, err
	}
	return scanPreview(row)
}

// ListPreviews implements [service.PreviewStatements].
func (os previewStatements) ListPreviews(ctx context.Context, projectID string) ([]*domain.Preview, error) {
	var items []*domain.Preview
	if err := os.db.Query(ctx, buildStatement(listPreviewsStmt, projectID).statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, scanPreview)
		return err
	}); err != nil {
		return nil, returnQueryError(err)
	}
	return items, nil
}

// DeletePreview implements [service.PreviewStatements].
func (os previewStatements) DeletePreview(ctx context.Context, projectID, origin string) error {
	n, err := os.db.Update(ctx, buildStatement(deletePreviewStmt, projectID, origin).statement())
	if err != nil {
		return wrapError(err)
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// DeleteExpiredPreviews implements [service.PreviewStatements].
func (os previewStatements) DeleteExpiredPreviews(ctx context.Context, now time.Time) (int64, error) {
	n, err := os.db.Update(ctx, buildStatement(deleteExpiredPreviews, now.UTC()).statement())
	if err != nil {
		return 0, wrapError(err)
	}
	return n, nil
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
