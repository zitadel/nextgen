package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/branding"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	brandingTable      = "branding"
	createBrandingStmt = `INSERT INTO branding (project_id, id, definition) VALUES (@p1, @p2, @p3) THEN RETURN created_at`
	brandingQuery      = `SELECT project_id, id, created_at, definition FROM branding`
)

var brandingColumns = []string{
	"project_id", "id", "created_at", "definition",
}

type brandingStatements struct{ statement }

func newBrandingStatements(db queryExecutor) brandingStatements {
	return brandingStatements{
		statement: statement{
			db: db,
		},
	}
}

// CreateBranding implements [service.BrandingStatements].
func (b brandingStatements) CreateBranding(ctx context.Context, entity *domain.Branding) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixBranding); err != nil {
		return err
	}
	raw, err := branding.Marshal(entity)
	if err != nil {
		return err
	}
	definition, err := encodeNullJSON(raw)
	if err != nil {
		return err
	}

	return withTransaction(ctx, b.db, func(ctx context.Context, tx queryExecutor) error {
		stmt := buildStatement(createBrandingStmt, entity.ProjectID, entity.ID, definition).statement()
		if err := tx.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
			_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
				if err := row.Columns(&entity.CreatedAt); err != nil {
					return struct{}{}, err
				}
				entity.CreatedAt = entity.CreatedAt.UTC()
				return struct{}{}, nil
			})
			return err
		}); err != nil {
			return err
		}
		rsi := newResourceScopeStatements(tx)
		return authz.BrandingCreated(ctx, &rsi, entity.ProjectID, entity.ID)
	})
}

// GetBrandingByID implements [service.BrandingStatements].
func (b brandingStatements) GetBrandingByID(ctx context.Context, projectID, id string) (*domain.Branding, error) {
	row, err := b.db.ReadRow(ctx, brandingTable, spanner.Key{projectID, id}, brandingColumns)
	if err != nil {
		return nil, err
	}
	return b.scanBranding(row)
}

// ListBrandings implements [service.BrandingStatements].
func (b brandingStatements) ListBrandings(ctx context.Context, filter *database.ListOptions[domain.BrandingField]) (*database.ListResult[*domain.Branding], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, brandingQuery, filter, branding.Schema); err != nil {
		return nil, err
	}

	var items []*domain.Branding
	err := b.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, b.scanBranding)
		return err
	})
	if err != nil {
		return nil, err
	}

	var nextCursor []byte
	if filter.Pagination.Limit > 0 && len(items) == int(filter.Pagination.Limit) {
		cursor := &pagination.Cursor[domain.BrandingField]{
			Columns: filter.Pagination.OrderBy.Columns,
			Values:  branding.Schema.ValuesFrom(items[len(items)-1], filter.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}

	return &database.ListResult[*domain.Branding]{
		Items:      items,
		NextCursor: nextCursor,
	}, nil
}

func (b brandingStatements) scanBranding(row *spanner.Row) (*domain.Branding, error) {
	var (
		projectID      string
		id             string
		createdAt      time.Time
		definitionJSON spanner.NullJSON
	)
	if err := row.Columns(&projectID, &id, &createdAt, &definitionJSON); err != nil {
		return nil, err
	}
	raw, err := decodeNullJSON(definitionJSON)
	if err != nil {
		return nil, err
	}
	return branding.ToDomain(projectID, id, createdAt, raw)
}

var _ service.BrandingStatements = (*brandingStatements)(nil)
