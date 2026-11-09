package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/oauthsettings"
)

const (
	createOAuthSettingsStmt = `INSERT INTO oauth_settings (project_id, id, definition, created_at) VALUES (?, ?, ?, ?) RETURNING created_at`
	oauthSettingsQuery      = `SELECT project_id, id, created_at, definition FROM oauth_settings`
)

type oauthSettingsStatements struct{ statement }

func newOAuthSettingsStatements(client queryExecutor) oauthSettingsStatements {
	return oauthSettingsStatements{statement: statement{client: client}}
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
	now := nowUnixNano()
	return withTransaction(ctx, o.client, func(ctx context.Context, tx queryExecutor) error {
		var createdNano int64
		if err := tx.QueryRow(ctx, createOAuthSettingsStmt, entity.ProjectID, entity.ID, string(raw), now).Scan(&createdNano); err != nil {
			return wrapError(err)
		}
		entity.CreatedAt = timeFromUnixNano(createdNano)
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindOAuthSettings, entity.ProjectID, entity.ID))
	})
}

// GetOAuthSettingsByID implements [service.OAuthSettingsStatements].
func (o oauthSettingsStatements) GetOAuthSettingsByID(ctx context.Context, projectID, id string) (*domain.OAuthSettings, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, oauthSettingsQuery, &database.ListOptions[domain.OAuthSettingsField]{
		Filter: database.And(
			database.Equal(database.Col(domain.OAuthSettingsFieldProjectID), projectID),
			database.Equal(database.Col(domain.OAuthSettingsFieldID), id),
		),
	}, oauthsettings.Schema); err != nil {
		return nil, err
	}
	rows, err := o.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	item, err := collectExactlyOneRow(rows, scanOAuthSettings)
	if err != nil {
		return nil, wrapError(err)
	}
	return item, nil
}

// ListOAuthSettings implements [service.OAuthSettingsStatements].
func (o oauthSettingsStatements) ListOAuthSettings(ctx context.Context, filter *database.ListOptions[domain.OAuthSettingsField]) (*database.ListResult[*domain.OAuthSettings], error) {
	items, nextCursor, err := pagination.Page(filter.Pagination, oauthsettings.Schema, func(limit uint32) ([]*domain.OAuthSettings, error) {
		filter := filter.WithLimit(limit)
		var compiler statementCompiler
		if err := compileList(ctx, &compiler, oauthSettingsQuery, filter, oauthsettings.Schema, "oauth_settings", "id"); err != nil {
			return nil, err
		}
		rows, err := o.client.Query(ctx, compiler.String(), compiler.args...)
		if err != nil {
			return nil, wrapError(err)
		}
		defer rows.Close()
		items, err := collectRows(rows, scanOAuthSettings)
		if err != nil {
			return nil, wrapError(err)
		}
		return items, nil
	})
	if err != nil {
		return nil, err
	}
	return &database.ListResult[*domain.OAuthSettings]{Items: items, NextCursor: nextCursor}, nil
}

func scanOAuthSettings(rows *sql.Rows) (*domain.OAuthSettings, error) {
	var (
		projectID   string
		id          string
		createdNano int64
		definition  string
	)
	if err := rows.Scan(&projectID, &id, &createdNano, &definition); err != nil {
		return nil, err
	}
	return oauthsettings.ToDomain(projectID, id, timeFromUnixNano(createdNano), []byte(definition))
}

var _ service.OAuthSettingsStatements = (*oauthSettingsStatements)(nil)
