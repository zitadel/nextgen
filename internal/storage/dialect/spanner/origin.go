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
	upsertOriginStmt = `INSERT OR UPDATE INTO origins (project_id, origin, expires_at)` +
		` VALUES (@p1, @p2, @p3) THEN RETURN created_at`
	originQuery          = `SELECT project_id, origin, expires_at, created_at FROM origins`
	listOriginsStmt      = originQuery + ` WHERE project_id = @p1 ORDER BY origin`
	deleteOriginStmt     = `DELETE FROM origins WHERE project_id = @p1 AND origin = @p2`
	deleteExpiredOrigins = `DELETE FROM origins WHERE expires_at <= @p1`
)

var originColumns = []string{"project_id", "origin", "expires_at", "created_at"}

type originStatements struct{ statement }

func newOriginStatements(db queryExecutor) originStatements {
	return originStatements{statement: statement{db: db}}
}

// UpsertOrigin implements [service.OriginStatements].
func (os originStatements) UpsertOrigin(ctx context.Context, entity *domain.Origin) error {
	stmt := buildStatement(upsertOriginStmt, entity.ProjectID, entity.Origin, entity.ExpiresAt.UTC()).statement()
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

// GetOrigin implements [service.OriginStatements].
func (os originStatements) GetOrigin(ctx context.Context, projectID, origin string) (*domain.Origin, error) {
	row, err := os.db.ReadRow(ctx, originsTable, spanner.Key{projectID, origin}, originColumns)
	if err != nil {
		return nil, err
	}
	return scanOrigin(row)
}

// ListOrigins implements [service.OriginStatements].
func (os originStatements) ListOrigins(ctx context.Context, projectID string) ([]*domain.Origin, error) {
	var items []*domain.Origin
	if err := os.db.Query(ctx, buildStatement(listOriginsStmt, projectID).statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, scanOrigin)
		return err
	}); err != nil {
		return nil, returnQueryError(err)
	}
	return items, nil
}

// DeleteOrigin implements [service.OriginStatements].
func (os originStatements) DeleteOrigin(ctx context.Context, projectID, origin string) error {
	n, err := os.db.Update(ctx, buildStatement(deleteOriginStmt, projectID, origin).statement())
	if err != nil {
		return wrapError(err)
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// DeleteExpiredOrigins implements [service.OriginStatements].
func (os originStatements) DeleteExpiredOrigins(ctx context.Context, now time.Time) (int64, error) {
	n, err := os.db.Update(ctx, buildStatement(deleteExpiredOrigins, now.UTC()).statement())
	if err != nil {
		return 0, wrapError(err)
	}
	return n, nil
}

func scanOrigin(row *spanner.Row) (*domain.Origin, error) {
	var entity domain.Origin
	if err := row.Columns(&entity.ProjectID, &entity.Origin, &entity.ExpiresAt, &entity.CreatedAt); err != nil {
		return nil, err
	}
	entity.ExpiresAt = entity.ExpiresAt.UTC()
	entity.CreatedAt = entity.CreatedAt.UTC()
	return &entity, nil
}

var _ service.OriginStatements = (*originStatements)(nil)
