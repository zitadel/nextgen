package spanner

import (
	"context"
	"encoding/json"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/branding"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

const (
	brandingTable      = "branding"
	createBrandingStmt = `INSERT INTO branding (project_id, id, definition) VALUES (@p1, @p2, @p3) THEN RETURN project_id, id, created_at, definition`
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
	raw, err := branding.Marshal(entity)
	if err != nil {
		return err
	}
	definition, err := encodeBrandingDefinitionJSON(raw)
	if err != nil {
		return err
	}

	stmt := buildStatement(createBrandingStmt, entity.ProjectID, entity.ID, definition).statement()
	return b.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			scanned, err := b.scanBranding(row)
			if err != nil {
				return struct{}{}, err
			}
			*entity = *scanned
			return struct{}{}, nil
		})
		return err
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

// GetLatestBranding implements [service.BrandingStatements].
func (b brandingStatements) GetLatestBranding(ctx context.Context, projectID string) (*domain.Branding, error) {
	// id (a ULID, time-ordered) breaks created_at ties deterministically —
	// e.g. revisions published within one transaction share NOW().
	var compiler statementCompiler
	if err := compileRead(&compiler, brandingQuery, &database.ListOptions[domain.BrandingField]{
		Filter: database.Equal(database.Col(domain.BrandingFieldProjectID), projectID),
		Pagination: database.Page[domain.BrandingField]{
			Limit: 1,
			OrderBy: database.OrderBy[domain.BrandingField]{
				Columns: []database.Column[domain.BrandingField]{
					database.Col(domain.BrandingFieldCreatedAt),
					database.Col(domain.BrandingFieldID),
				},
				Direction: database.OrderDesc,
			},
		},
	}, branding.Schema); err != nil {
		return nil, err
	}

	var entity *domain.Branding
	err := b.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		entity, err = collectOneRow(iter, b.scanBranding)
		return err
	})
	if err != nil {
		return nil, err
	}
	return entity, nil
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
	raw, err := decodeBrandingDefinitionJSON(definitionJSON)
	if err != nil {
		return nil, err
	}
	return branding.ToDomain(projectID, id, createdAt, raw)
}

func encodeBrandingDefinitionJSON(raw []byte) (spanner.NullJSON, error) {
	if len(raw) == 0 {
		return spanner.NullJSON{Valid: false}, nil
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return spanner.NullJSON{}, err
	}
	return spanner.NullJSON{Value: v, Valid: true}, nil
}

func decodeBrandingDefinitionJSON(v spanner.NullJSON) ([]byte, error) {
	if !v.Valid {
		return nil, nil
	}
	return json.Marshal(v.Value)
}

var _ service.BrandingStatements = (*brandingStatements)(nil)
