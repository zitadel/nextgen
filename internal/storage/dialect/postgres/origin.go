package postgres

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	listOriginsByProjectStmt = `SELECT pattern, kind FROM zitadel_nextgen.project_origins
WHERE project_id = $1
ORDER BY created_at ASC, pattern ASC`

	getOriginByPatternStmt = `SELECT pattern, kind FROM zitadel_nextgen.project_origins
WHERE project_id = $1 AND pattern = $2`

	// clock_timestamp() (not now()) so sequential inserts in one transaction
	// keep distinct created_at values; list order is created_at then pattern.
	insertOriginStmt = `INSERT INTO zitadel_nextgen.project_origins (project_id, pattern, kind, created_at)
VALUES ($1, $2, $3, clock_timestamp())
ON CONFLICT (project_id, pattern) DO NOTHING`

	deleteOriginByPatternStmt = `DELETE FROM zitadel_nextgen.project_origins
WHERE project_id = $1 AND pattern = $2
RETURNING pattern, kind`
)

type originStatements struct{ statement }

func newOriginStatements(client queryExecutor) originStatements {
	return originStatements{statement: statement{client: client}}
}

// ListOriginsByProjectID implements [service.OriginStatements].
func (s originStatements) ListOriginsByProjectID(ctx context.Context, projectID string) ([]domain.Origin, error) {
	rows, err := s.client.Query(ctx, listOriginsByProjectStmt, projectID)
	if err != nil {
		return nil, wrapError(err)
	}
	origins, err := pgx.CollectRows(rows, scanOrigin)
	if err != nil {
		return nil, wrapError(err)
	}
	if origins == nil {
		origins = []domain.Origin{}
	}
	return origins, nil
}

// ListOriginsByProjectIDs implements [service.OriginStatements].
func (s originStatements) ListOriginsByProjectIDs(ctx context.Context, projectIDs []string) (map[string][]domain.Origin, error) {
	out := make(map[string][]domain.Origin, len(projectIDs))
	if len(projectIDs) == 0 {
		return out, nil
	}
	rows, err := s.client.Query(ctx, `SELECT project_id, pattern, kind FROM zitadel_nextgen.project_origins
WHERE project_id = ANY($1)
ORDER BY project_id ASC, created_at ASC, pattern ASC`, projectIDs)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	for rows.Next() {
		var projectID, pattern, kind string
		if err := rows.Scan(&projectID, &pattern, &kind); err != nil {
			return nil, wrapError(err)
		}
		out[projectID] = append(out[projectID], domain.Origin{
			Pattern: pattern,
			Kind:    domain.OriginKind(kind),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, wrapError(err)
	}
	for _, id := range projectIDs {
		if _, ok := out[id]; !ok {
			out[id] = []domain.Origin{}
		}
	}
	return out, nil
}

// GetOriginByPattern implements [service.OriginStatements].
func (s originStatements) GetOriginByPattern(ctx context.Context, projectID, pattern string) (*domain.Origin, error) {
	origin, err := scanOriginRow(s.client.QueryRow(ctx, getOriginByPatternStmt, projectID, pattern))
	if err != nil {
		return nil, wrapError(err)
	}
	return &origin, nil
}

// InsertOrigin implements [service.OriginStatements].
func (s originStatements) InsertOrigin(ctx context.Context, projectID string, origin domain.Origin) (bool, error) {
	tag, err := s.client.Exec(ctx, insertOriginStmt, projectID, strings.TrimSpace(origin.Pattern), string(origin.Kind))
	if err != nil {
		return false, wrapError(err)
	}
	return tag.RowsAffected() > 0, nil
}

// DeleteOriginByPattern implements [service.OriginStatements].
func (s originStatements) DeleteOriginByPattern(ctx context.Context, projectID, pattern string) (bool, *domain.Origin, error) {
	origin, err := scanOriginRow(s.client.QueryRow(ctx, deleteOriginByPatternStmt, projectID, pattern))
	if err != nil {
		wrapped := wrapError(err)
		var noRow *database.NoRowFoundError
		if errors.As(wrapped, &noRow) {
			return false, nil, nil
		}
		return false, nil, wrapped
	}
	return true, &origin, nil
}

func scanOrigin(row pgx.CollectableRow) (domain.Origin, error) {
	return scanOriginRow(row)
}

func scanOriginRow(row interface{ Scan(dest ...any) error }) (domain.Origin, error) {
	var pattern, kind string
	if err := row.Scan(&pattern, &kind); err != nil {
		return domain.Origin{}, err
	}
	return domain.Origin{Pattern: pattern, Kind: domain.OriginKind(kind)}, nil
}

var _ service.OriginStatements = (*originStatements)(nil)
