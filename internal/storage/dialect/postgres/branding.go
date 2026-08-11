package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/branding"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	createBrandingStmt = `INSERT INTO zitadel_nextgen.branding (project_id, id, definition) VALUES ($1, $2, $3) RETURNING created_at`
	brandingQuery      = `SELECT project_id, id, created_at, definition FROM zitadel_nextgen.branding`
)

type brandingStatements struct{ statement }

func newBrandingStatements(client queryExecutor) brandingStatements {
	return brandingStatements{
		statement: statement{
			client: client,
		},
	}
}

// CreateBranding implements [service.BrandingStatements].
func (b brandingStatements) CreateBranding(ctx context.Context, entity *domain.Branding) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixBranding); err != nil {
		return err
	}
	definition, err := branding.Marshal(entity)
	if err != nil {
		return err
	}
	return withTransaction(ctx, b.client, func(ctx context.Context, tx queryExecutor) error {
		if err := tx.QueryRow(ctx, createBrandingStmt, entity.ProjectID, entity.ID, definition).
			Scan(&entity.CreatedAt); err != nil {
			return wrapError(err)
		}
		entity.CreatedAt = entity.CreatedAt.UTC()
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindBranding, entity.ProjectID, entity.ID))
	})
}

// GetBrandingByID implements [service.BrandingStatements].
func (b brandingStatements) GetBrandingByID(ctx context.Context, projectID, id string) (*domain.Branding, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, brandingQuery, &database.ListOptions[domain.BrandingField]{
		Filter: database.And(
			database.Equal(database.Col(domain.BrandingFieldProjectID), projectID),
			database.Equal(database.Col(domain.BrandingFieldID), id),
		),
	}, branding.Schema); err != nil {
		return nil, err
	}

	rows, err := b.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	entity, err := pgx.CollectExactlyOneRow(rows, b.scanBranding)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
}

// ListBrandings implements [service.BrandingStatements].
func (b brandingStatements) ListBrandings(ctx context.Context, filter *database.ListOptions[domain.BrandingField]) (*database.ListResult[*domain.Branding], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, brandingQuery, filter, branding.Schema); err != nil {
		return nil, err
	}

	rows, err := b.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}

	items, err := pgx.CollectRows(rows, b.scanBranding)
	if err != nil {
		return nil, wrapError(err)
	}

	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		items,
		branding.Schema,
		filter.Pagination.Limit,
	)

	return &database.ListResult[*domain.Branding]{
		Items:      items,
		NextCursor: nextCursor,
	}, nil
}

func (b brandingStatements) scanBranding(row pgx.CollectableRow) (*domain.Branding, error) {
	var (
		projectID  string
		id         string
		createdAt  time.Time
		definition []byte
	)
	if err := row.Scan(&projectID, &id, &createdAt, &definition); err != nil {
		return nil, err
	}
	return branding.ToDomain(projectID, id, createdAt, definition)
}

var _ service.BrandingStatements = (*brandingStatements)(nil)
