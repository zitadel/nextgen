package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/zitadel/v5/internal/domain"
	"github.com/zitadel/zitadel/v5/internal/service"
	"github.com/zitadel/zitadel/v5/internal/storage/branding"
	"github.com/zitadel/zitadel/v5/internal/storage/database"
	"github.com/zitadel/zitadel/v5/internal/storage/dialect/pagination"
)

const (
	createBrandingStmt = `INSERT INTO branding (project_id, id, definition, created_at) VALUES (?, ?, ?, ?) RETURNING created_at`
	brandingQuery      = `SELECT project_id, id, created_at, definition FROM branding`
)

type brandingStatements struct{ statement }

func newBrandingStatements(client queryExecutor) brandingStatements {
	return brandingStatements{statement: statement{client: client}}
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
	var defArg any
	if len(raw) > 0 {
		defArg = string(raw)
	}
	now := nowUnixNano()
	return withTransaction(ctx, b.client, func(ctx context.Context, tx queryExecutor) error {
		var createdNano int64
		if err := tx.QueryRow(ctx, createBrandingStmt, entity.ProjectID, entity.ID, defArg, now).Scan(&createdNano); err != nil {
			return wrapError(err)
		}
		entity.CreatedAt = timeFromUnixNano(createdNano)
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
	defer rows.Close()
	item, err := collectExactlyOneRow(rows, scanBranding)
	if err != nil {
		return nil, wrapError(err)
	}
	return item, nil
}

// ListBrandings implements [service.BrandingStatements].
func (b brandingStatements) ListBrandings(ctx context.Context, filter *database.ListOptions[domain.BrandingField]) (*database.ListResult[*domain.Branding], error) {
	items, nextCursor, err := pagination.Page(filter.Pagination, branding.Schema, func(limit uint32) ([]*domain.Branding, error) {
		filter := filter.WithLimit(limit)
		var compiler statementCompiler
		if err := compileList(ctx, &compiler, brandingQuery, filter, branding.Schema, "branding", "id"); err != nil {
			return nil, err
		}
		rows, err := b.client.Query(ctx, compiler.String(), compiler.args...)
		if err != nil {
			return nil, wrapError(err)
		}
		defer rows.Close()
		items, err := collectRows(rows, scanBranding)
		if err != nil {
			return nil, wrapError(err)
		}
		return items, nil
	})
	if err != nil {
		return nil, err
	}
	return &database.ListResult[*domain.Branding]{Items: items, NextCursor: nextCursor}, nil
}

func scanBranding(rows *sql.Rows) (*domain.Branding, error) {
	var (
		projectID   string
		id          string
		createdNano int64
		definition  sql.NullString
	)
	if err := rows.Scan(&projectID, &id, &createdNano, &definition); err != nil {
		return nil, err
	}
	createdAt := timeFromUnixNano(createdNano)
	var raw []byte
	if definition.Valid && definition.String != "" {
		raw = []byte(definition.String)
	}
	return branding.ToDomain(projectID, id, createdAt, raw)
}

var _ service.BrandingStatements = (*brandingStatements)(nil)
