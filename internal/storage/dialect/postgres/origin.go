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
	upsertOriginStmt = `INSERT INTO zitadel_nextgen.origins (project_id, origin, expires_at)` +
		` VALUES ($1, $2, $3)` +
		` ON CONFLICT (project_id, origin) DO UPDATE SET expires_at = EXCLUDED.expires_at` +
		` RETURNING created_at`
	originQuery          = `SELECT project_id, origin, expires_at, created_at FROM zitadel_nextgen.origins`
	getOriginStmt        = originQuery + ` WHERE project_id = $1 AND origin = $2`
	listOriginsStmt      = originQuery + ` WHERE project_id = $1 ORDER BY origin`
	deleteOriginStmt     = `DELETE FROM zitadel_nextgen.origins WHERE project_id = $1 AND origin = $2`
	deleteExpiredOrigins = `DELETE FROM zitadel_nextgen.origins WHERE expires_at <= $1`
)

type originStatements struct{ statement }

func newOriginStatements(client queryExecutor) originStatements {
	return originStatements{statement: statement{client: client}}
}

// UpsertOrigin implements [service.OriginStatements].
func (os originStatements) UpsertOrigin(ctx context.Context, entity *domain.Origin) error {
	if err := os.client.QueryRow(ctx, upsertOriginStmt, entity.ProjectID, entity.Origin, entity.ExpiresAt).
		Scan(&entity.CreatedAt); err != nil {
		return wrapError(err)
	}
	entity.CreatedAt = entity.CreatedAt.UTC()
	entity.ExpiresAt = entity.ExpiresAt.UTC()
	return nil
}

// GetOrigin implements [service.OriginStatements].
func (os originStatements) GetOrigin(ctx context.Context, projectID, origin string) (*domain.Origin, error) {
	rows, err := os.client.Query(ctx, getOriginStmt, projectID, origin)
	if err != nil {
		return nil, wrapError(err)
	}
	entity, err := pgx.CollectExactlyOneRow(rows, scanOrigin)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
}

// ListOrigins implements [service.OriginStatements].
func (os originStatements) ListOrigins(ctx context.Context, projectID string) ([]*domain.Origin, error) {
	rows, err := os.client.Query(ctx, listOriginsStmt, projectID)
	if err != nil {
		return nil, wrapError(err)
	}
	items, err := pgx.CollectRows(rows, scanOrigin)
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

// DeleteOrigin implements [service.OriginStatements].
func (os originStatements) DeleteOrigin(ctx context.Context, projectID, origin string) error {
	tag, err := os.client.Exec(ctx, deleteOriginStmt, projectID, origin)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// DeleteExpiredOrigins implements [service.OriginStatements].
func (os originStatements) DeleteExpiredOrigins(ctx context.Context, now time.Time) (int64, error) {
	tag, err := os.client.Exec(ctx, deleteExpiredOrigins, now)
	if err != nil {
		return 0, wrapError(err)
	}
	return tag.RowsAffected(), nil
}

func scanOrigin(row pgx.CollectableRow) (*domain.Origin, error) {
	var entity domain.Origin
	if err := row.Scan(&entity.ProjectID, &entity.Origin, &entity.ExpiresAt, &entity.CreatedAt); err != nil {
		return nil, err
	}
	entity.ExpiresAt = entity.ExpiresAt.UTC()
	entity.CreatedAt = entity.CreatedAt.UTC()
	return &entity, nil
}

var _ service.OriginStatements = (*originStatements)(nil)
