package postgres

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	originQuery = `SELECT project_id, pattern, kind, created_at FROM zitadel_nextgen.project_origins`

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

// GetOrigin implements [service.OriginStatements].
func (s originStatements) GetOrigin(ctx context.Context, filter database.Filter[domain.OriginField]) (*domain.Origin, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, originQuery, &database.ListOptions[domain.OriginField]{
		Filter: filter,
	}, originSchema); err != nil {
		return nil, err
	}

	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	origin, err := pgx.CollectExactlyOneRow(rows, scanOrigin)
	if err != nil {
		return nil, wrapError(err)
	}
	return origin, nil
}

// ListOrigins implements [service.OriginStatements].
func (s originStatements) ListOrigins(ctx context.Context, filter *database.ListOptions[domain.OriginField]) (*database.ListResult[*domain.Origin], error) {
	if filter == nil {
		filter = &database.ListOptions[domain.OriginField]{}
	}
	if len(filter.Pagination.OrderBy.Columns) == 0 {
		filter.Pagination.OrderBy.Columns = []database.Column[domain.OriginField]{
			database.Col(domain.OriginFieldCreatedAt),
			database.Col(domain.OriginFieldPattern),
		}
	}

	origins, nextCursor, err := pagination.Page(filter.Pagination, originSchema, func(limit uint32) ([]*domain.Origin, error) {
		page := filter.WithLimit(limit)
		var compiler statementCompiler
		// Empty table/resource skips management-list authz: origins hydrate under project reads.
		if err := compileList(ctx, &compiler, originQuery, page, originSchema, "", ""); err != nil {
			return nil, err
		}

		rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
		if err != nil {
			return nil, wrapError(err)
		}
		origins, err := pgx.CollectRows(rows, scanOrigin)
		if err != nil {
			return nil, wrapError(err)
		}
		return origins, nil
	})
	if err != nil {
		return nil, err
	}
	if origins == nil {
		origins = []*domain.Origin{}
	}
	return &database.ListResult[*domain.Origin]{
		Items:      origins,
		NextCursor: nextCursor,
	}, nil
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
	var patternOut, kind string
	err := s.client.QueryRow(ctx, deleteOriginByPatternStmt, projectID, pattern).Scan(&patternOut, &kind)
	if err != nil {
		wrapped := wrapError(err)
		var noRow *database.NoRowFoundError
		if errors.As(wrapped, &noRow) {
			return false, nil, nil
		}
		return false, nil, wrapped
	}
	return true, &domain.Origin{Pattern: patternOut, Kind: domain.OriginKind(kind)}, nil
}

func scanOrigin(row pgx.CollectableRow) (*domain.Origin, error) {
	origin := new(domain.Origin)
	var kind string
	if err := row.Scan(&origin.ProjectID, &origin.Pattern, &kind, &origin.CreatedAt); err != nil {
		return nil, err
	}
	origin.Kind = domain.OriginKind(kind)
	return origin, nil
}

var _ service.OriginStatements = (*originStatements)(nil)

var originSchema = database.NewSchema(map[domain.OriginField]database.FieldBinding[domain.Origin]{
	domain.OriginFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(o *domain.Origin) any { return o.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.OriginFieldPattern: {
		SQLName:  "pattern",
		Accessor: func(o *domain.Origin) any { return o.Pattern },
		Coerce:   database.CoerceString,
	},
	domain.OriginFieldKind: {
		SQLName:  "kind",
		Accessor: func(o *domain.Origin) any { return string(o.Kind) },
		Coerce:   database.CoerceString,
	},
	domain.OriginFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(o *domain.Origin) any { return o.CreatedAt },
		Coerce:   database.CoerceTime,
	},
})
