package postgres

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/settings"
)

const (
	settingsQuery = `SELECT path, project_id, team_id, application_id, user_id, value, is_final, created_at, modified_at
FROM zitadel_nextgen.settings`

	// The conflict target is the natural key, so a rewrite at the same owner
	// replaces the leaf instead of adding a second one at that level.
	setSettingStmt = `INSERT INTO zitadel_nextgen.settings (path, project_id, team_id, application_id, user_id, value, is_final)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (path, project_id, team_id, application_id, user_id)
DO UPDATE SET value = EXCLUDED.value, is_final = EXCLUDED.is_final, modified_at = NOW()`

	// Every owner column is matched exactly, so this can only remove the leaf
	// the caller owns -- never one it merely inherits.
	deleteSettingStmt = `DELETE FROM zitadel_nextgen.settings
WHERE path = $1 AND project_id = $2 AND team_id = $3 AND application_id = $4 AND user_id = $5`
)

type settingsStatements struct{ statement }

func newSettingsStatements(client queryExecutor) settingsStatements {
	return settingsStatements{statement: statement{client: client}}
}

func (s settingsStatements) GetSettings(ctx context.Context, requester domain.SettingOwner, paths ...string) ([]*domain.Setting, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, settingsQuery, settings.VisibleTo(requester, paths...), settings.Schema); err != nil {
		return nil, err
	}

	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	items, err := pgx.CollectRows(rows, scanSetting)
	if err != nil {
		return nil, wrapError(err)
	}
	return settings.ToDomain(items), nil
}

func (s settingsStatements) SetSetting(ctx context.Context, owner domain.SettingOwner, path string, value any, isFinal bool) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if _, err := s.client.Exec(ctx, setSettingStmt,
		path, owner.ProjectID, owner.TeamID, owner.ApplicationID, owner.UserID,
		encoded, isFinal,
	); err != nil {
		return wrapError(err)
	}
	return nil
}

func (s settingsStatements) DeleteSetting(ctx context.Context, owner domain.SettingOwner, path string) error {
	tag, err := s.client.Exec(ctx, deleteSettingStmt,
		path, owner.ProjectID, owner.TeamID, owner.ApplicationID, owner.UserID,
	)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

func scanSetting(row pgx.CollectableRow) (*settings.SettingStorage, error) {
	var (
		stored  settings.SettingStorage
		encoded []byte
	)
	if err := row.Scan(
		&stored.Path, &stored.ProjectID, &stored.TeamID, &stored.ApplicationID, &stored.UserID,
		&encoded, &stored.IsFinal, &stored.CreatedAt, &stored.ModifiedAt,
	); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(encoded, &stored.Value); err != nil {
		return nil, err
	}
	stored.CreatedAt = stored.CreatedAt.UTC()
	stored.ModifiedAt = stored.ModifiedAt.UTC()
	return &stored, nil
}

var _ service.SettingsStatements = (*settingsStatements)(nil)
