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
	upsertOriginStmt = `INSERT INTO origins (project_id, origin, expires_at, created_at)` +
		` VALUES (?, ?, ?, ?)` +
		` ON CONFLICT (project_id, origin) DO UPDATE SET expires_at = excluded.expires_at` +
		` RETURNING created_at`
	originQuery          = `SELECT project_id, origin, expires_at, created_at FROM origins`
	getOriginStmt        = originQuery + ` WHERE project_id = ? AND origin = ?`
	listOriginsStmt      = originQuery + ` WHERE project_id = ? ORDER BY origin`
	deleteOriginStmt     = `DELETE FROM origins WHERE project_id = ? AND origin = ?`
	deleteExpiredOrigins = `DELETE FROM origins WHERE expires_at <= ?`
)

type originStatements struct{ statement }

func newOriginStatements(client queryExecutor) originStatements {
	return originStatements{statement: statement{client: client}}
}

// UpsertOrigin implements [service.OriginStatements].
func (os originStatements) UpsertOrigin(ctx context.Context, entity *domain.Origin) error {
	var createdNano int64
	if err := os.client.QueryRow(ctx, upsertOriginStmt,
		entity.ProjectID, entity.Origin, entity.ExpiresAt.UTC().UnixNano(), nowUnixNano(),
	).Scan(&createdNano); err != nil {
		return wrapError(err)
	}
	entity.CreatedAt = timeFromUnixNano(createdNano)
	entity.ExpiresAt = entity.ExpiresAt.UTC()
	return nil
}

// GetOrigin implements [service.OriginStatements].
func (os originStatements) GetOrigin(ctx context.Context, projectID, origin string) (*domain.Origin, error) {
	rows, err := os.client.Query(ctx, getOriginStmt, projectID, origin)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	entity, err := collectExactlyOneRow(rows, scanOrigin)
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
	defer rows.Close()
	items, err := collectRows(rows, scanOrigin)
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

// DeleteOrigin implements [service.OriginStatements].
func (os originStatements) DeleteOrigin(ctx context.Context, projectID, origin string) error {
	n, err := execAffected(ctx, os.client, deleteOriginStmt, projectID, origin)
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// DeleteExpiredOrigins implements [service.OriginStatements].
func (os originStatements) DeleteExpiredOrigins(ctx context.Context, now time.Time) (int64, error) {
	return execAffected(ctx, os.client, deleteExpiredOrigins, now.UTC().UnixNano())
}

func scanOrigin(rows *sql.Rows) (*domain.Origin, error) {
	var (
		entity                   domain.Origin
		expiresNano, createdNano int64
	)
	if err := rows.Scan(&entity.ProjectID, &entity.Origin, &expiresNano, &createdNano); err != nil {
		return nil, err
	}
	entity.ExpiresAt = timeFromUnixNano(expiresNano)
	entity.CreatedAt = timeFromUnixNano(createdNano)
	return &entity, nil
}

var _ service.OriginStatements = (*originStatements)(nil)
