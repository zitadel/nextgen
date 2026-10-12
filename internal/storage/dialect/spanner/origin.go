package spanner

import (
	"context"
	"errors"
	"strings"
	"time"

	"cloud.google.com/go/spanner"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	projectOriginsTable = "project_origins"

	listOriginsByProjectStmt = `SELECT pattern, kind FROM project_origins
WHERE project_id = @p1
ORDER BY created_at ASC, pattern ASC`

	// Explicit created_at so sequential inserts in one transaction keep a
	// stable list order (created_at then pattern) instead of collapsing on
	// the column default.
	insertOriginStmt = `INSERT INTO project_origins (project_id, pattern, kind, created_at) VALUES (@p1, @p2, @p3, @p4)`

	deleteOriginByPatternStmt = `DELETE FROM project_origins
WHERE project_id = @p1 AND pattern = @p2`
)

var projectOriginColumns = []string{"pattern", "kind"}

type originStatements struct{ statement }

func newOriginStatements(db queryExecutor) originStatements {
	return originStatements{statement: statement{db: db}}
}

// ListOriginsByProjectID implements [service.OriginStatements].
func (s originStatements) ListOriginsByProjectID(ctx context.Context, projectID string) ([]domain.Origin, error) {
	var origins []domain.Origin
	err := s.db.Query(ctx, buildStatement(listOriginsByProjectStmt, projectID).statement(), func(iter *spanner.RowIterator) error {
		var err error
		origins, err = collectRows(iter, scanOrigin)
		return err
	})
	if err != nil {
		return nil, returnQueryError(err)
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
	row, err := s.db.ReadRow(ctx, projectOriginsTable, spanner.Key{projectID, pattern}, projectOriginColumns)
	if err != nil {
		return nil, err
	}
	origin, err := scanOrigin(row)
	if err != nil {
		return nil, wrapError(err)
	}
	return &origin, nil
}

// InsertOrigin implements [service.OriginStatements].
func (s originStatements) InsertOrigin(ctx context.Context, projectID string, origin domain.Origin) (bool, error) {
	stmt := buildStatement(
		insertOriginStmt,
		projectID,
		strings.TrimSpace(origin.Pattern),
		string(origin.Kind),
		time.Now().UTC(),
	).statement()
	if _, err := s.db.Update(ctx, stmt); err != nil {
		if status.Code(err) == codes.AlreadyExists {
			return false, nil
		}
		return false, wrapError(err)
	}
	return true, nil
}

// DeleteOriginByPattern implements [service.OriginStatements].
func (s originStatements) DeleteOriginByPattern(ctx context.Context, projectID, pattern string) (bool, *domain.Origin, error) {
	existing, err := s.GetOriginByPattern(ctx, projectID, pattern)
	if err != nil {
		var noRow *database.NoRowFoundError
		if errors.As(err, &noRow) {
			return false, nil, nil
		}
		return false, nil, err
	}
	n, err := s.db.Update(ctx, buildStatement(deleteOriginByPatternStmt, projectID, pattern).statement())
	if err != nil {
		return false, nil, wrapError(err)
	}
	if n == 0 {
		return false, nil, nil
	}
	return true, existing, nil
}

func scanOrigin(row *spanner.Row) (domain.Origin, error) {
	var pattern, kind string
	if err := row.Columns(&pattern, &kind); err != nil {
		return domain.Origin{}, err
	}
	return domain.Origin{Pattern: pattern, Kind: domain.OriginKind(kind)}, nil
}

var _ service.OriginStatements = (*originStatements)(nil)
