package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	listOriginsByProjectStmt = `SELECT pattern, kind FROM project_origins
WHERE project_id = ?
ORDER BY created_at ASC, pattern ASC`

	getOriginByPatternStmt = `SELECT pattern, kind FROM project_origins
WHERE project_id = ? AND pattern = ?`

	insertOriginStmt = `INSERT OR IGNORE INTO project_origins (project_id, pattern, kind, created_at)
VALUES (?, ?, ?, ?)`

	deleteOriginByPatternStmt = `DELETE FROM project_origins
WHERE project_id = ? AND pattern = ?
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
	defer rows.Close()
	origins, err := collectRows(rows, scanOrigin)
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
	for _, id := range projectIDs {
		origins, err := s.ListOriginsByProjectID(ctx, id)
		if err != nil {
			return nil, err
		}
		out[id] = origins
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
	res, err := s.client.Exec(ctx, insertOriginStmt,
		projectID, strings.TrimSpace(origin.Pattern), string(origin.Kind), nowUnixNano())
	if err != nil {
		return false, wrapError(err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, wrapError(err)
	}
	return n > 0, nil
}

// DeleteOriginByPattern implements [service.OriginStatements].
func (s originStatements) DeleteOriginByPattern(ctx context.Context, projectID, pattern string) (bool, *domain.Origin, error) {
	origin, err := scanOriginRow(s.client.QueryRow(ctx, deleteOriginByPatternStmt, projectID, pattern))
	if err != nil {
		wrapped := wrapError(err)
		var noRow *database.NoRowFoundError
		if errors.As(wrapped, &noRow) || errors.Is(err, sql.ErrNoRows) {
			return false, nil, nil
		}
		return false, nil, wrapped
	}
	return true, &origin, nil
}

func scanOrigin(rows *sql.Rows) (domain.Origin, error) {
	return scanOriginRow(rows)
}

func scanOriginRow(row interface{ Scan(dest ...any) error }) (domain.Origin, error) {
	var pattern, kind string
	if err := row.Scan(&pattern, &kind); err != nil {
		return domain.Origin{}, err
	}
	return domain.Origin{Pattern: pattern, Kind: domain.OriginKind(kind)}, nil
}

var _ service.OriginStatements = (*originStatements)(nil)
