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
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	originQuery = `SELECT project_id, pattern, kind, created_at FROM project_origins`

	// Explicit created_at so sequential inserts in one transaction keep a
	// stable list order (created_at then pattern) instead of collapsing on
	// the column default.
	insertOriginStmt = `INSERT INTO project_origins (project_id, pattern, kind, created_at) VALUES (@p1, @p2, @p3, @p4)`

	deleteOriginByPatternStmt = `DELETE FROM project_origins
WHERE project_id = @p1 AND pattern = @p2`
)

type originStatements struct{ statement }

func newOriginStatements(db queryExecutor) originStatements {
	return originStatements{statement: statement{db: db}}
}

// GetOrigin implements [service.OriginStatements].
func (s originStatements) GetOrigin(ctx context.Context, filter database.Filter[domain.OriginField]) (*domain.Origin, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, originQuery, &database.ListOptions[domain.OriginField]{
		Filter: filter,
	}, originSchema); err != nil {
		return nil, err
	}

	var origin *domain.Origin
	err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		origin, err = collectOneRow(iter, scanOrigin)
		return err
	})
	if err != nil {
		return nil, err
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

		var origins []*domain.Origin
		err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
			var err error
			origins, err = collectRows(iter, scanOrigin)
			return err
		})
		if err != nil {
			return nil, err
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
	existing, err := s.GetOrigin(ctx, database.And(
		database.Equal(database.Col(domain.OriginFieldProjectID), projectID),
		database.Equal(database.Col(domain.OriginFieldPattern), pattern),
	))
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
	return true, &domain.Origin{Pattern: existing.Pattern, Kind: existing.Kind}, nil
}

func scanOrigin(row *spanner.Row) (*domain.Origin, error) {
	origin := new(domain.Origin)
	var kind string
	if err := row.Columns(&origin.ProjectID, &origin.Pattern, &kind, &origin.CreatedAt); err != nil {
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
