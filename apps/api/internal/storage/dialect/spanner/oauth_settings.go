package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/oauthsettings"
)

const (
	oauthSettingsTable      = "oauth_settings"
	createOAuthSettingsStmt = `INSERT INTO oauth_settings (project_id, id, definition) VALUES (@p1, @p2, @p3) THEN RETURN created_at`
	oauthSettingsQuery      = `SELECT project_id, id, created_at, definition FROM oauth_settings`
)

var oauthSettingsColumns = []string{
	"project_id", "id", "created_at", "definition",
}

type oauthSettingsStatements struct{ statement }

func newOAuthSettingsStatements(db queryExecutor) oauthSettingsStatements {
	return oauthSettingsStatements{
		statement: statement{
			db: db,
		},
	}
}

// CreateOAuthSettings implements [service.OAuthSettingsStatements].
func (o oauthSettingsStatements) CreateOAuthSettings(ctx context.Context, entity *domain.OAuthSettings) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixOAuthSettings); err != nil {
		return err
	}
	raw, err := oauthsettings.Marshal(entity)
	if err != nil {
		return err
	}
	definition, err := encodeNullJSON(raw)
	if err != nil {
		return err
	}

	return withTransaction(ctx, o.db, func(ctx context.Context, tx queryExecutor) error {
		stmt := buildStatement(createOAuthSettingsStmt, entity.ProjectID, entity.ID, definition).statement()
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
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindOAuthSettings, entity.ProjectID, entity.ID))
	})
}

// GetOAuthSettingsByID implements [service.OAuthSettingsStatements].
func (o oauthSettingsStatements) GetOAuthSettingsByID(ctx context.Context, projectID, id string) (*domain.OAuthSettings, error) {
	row, err := o.db.ReadRow(ctx, oauthSettingsTable, spanner.Key{projectID, id}, oauthSettingsColumns)
	if err != nil {
		return nil, err
	}
	return o.scanOAuthSettings(row)
}

// ListOAuthSettings implements [service.OAuthSettingsStatements].
func (o oauthSettingsStatements) ListOAuthSettings(ctx context.Context, filter *database.ListOptions[domain.OAuthSettingsField]) (*database.ListResult[*domain.OAuthSettings], error) {
	items, nextCursor, err := pagination.Page(filter.Pagination, oauthsettings.Schema, func(limit uint32) ([]*domain.OAuthSettings, error) {
		filter := filter.WithLimit(limit)
		var compiler statementCompiler
		if err := compileList(ctx, &compiler, oauthSettingsQuery, filter, oauthsettings.Schema, oauthSettingsTable, "id"); err != nil {
			return nil, err
		}

		var items []*domain.OAuthSettings
		err := o.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
			var err error
			items, err = collectRows(iter, o.scanOAuthSettings)
			return err
		})
		if err != nil {
			return nil, err
		}

		return items, nil
	})
	if err != nil {
		return nil, err
	}
	return &database.ListResult[*domain.OAuthSettings]{
		Items:      items,
		NextCursor: nextCursor,
	}, nil
}

func (o oauthSettingsStatements) scanOAuthSettings(row *spanner.Row) (*domain.OAuthSettings, error) {
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
	return oauthsettings.ToDomain(projectID, id, createdAt, raw)
}

var _ service.OAuthSettingsStatements = (*oauthSettingsStatements)(nil)
