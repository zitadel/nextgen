package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/settings"
)

const (
	settingsQuery = `SELECT path, project_id, team_id, application_id, user_id, value, is_final, created_at, modified_at
FROM settings`

	// The conflict target is the natural key, so a rewrite at the same owner
	// replaces the leaf instead of adding a second one at that level.
	setSettingStmt = `INSERT INTO settings (path, project_id, team_id, application_id, user_id, value, is_final, created_at, modified_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (path, project_id, team_id, application_id, user_id)
DO UPDATE SET value = excluded.value, is_final = excluded.is_final, modified_at = excluded.modified_at`

	// Every owner column is matched exactly, so this can only remove the leaf
	// the caller owns -- never one it merely inherits.
	deleteSettingStmt = `DELETE FROM settings
WHERE path = ? AND project_id = ? AND team_id = ? AND application_id = ? AND user_id = ?`
)

type settingsStatements struct{ statement }

func newSettingsStatements(client queryExecutor) settingsStatements {
	return settingsStatements{statement: statement{client: client}}
}

// GetSettings implements [service.SettingsStatements].
func (s settingsStatements) GetSettings(ctx context.Context, requester domain.SettingOwner, paths ...string) ([]*domain.Setting, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, settingsQuery, settings.VisibleTo(requester, paths...), settings.Schema); err != nil {
		return nil, err
	}

	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	items, err := collectRows(rows, scanSetting)
	if err != nil {
		return nil, wrapError(err)
	}
	return settings.ToDomain(items), nil
}

// SetSetting implements [service.SettingsStatements].
func (s settingsStatements) SetSetting(ctx context.Context, owner domain.SettingOwner, path string, value any, isFinal bool) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	now := nowUnixNano()
	_, err = execAffected(ctx, s.client, setSettingStmt,
		path, owner.ProjectID, owner.TeamID, owner.ApplicationID, owner.UserID,
		string(encoded), isFinal, now, now,
	)
	return err
}

// DeleteSetting implements [service.SettingsStatements].
func (s settingsStatements) DeleteSetting(ctx context.Context, owner domain.SettingOwner, path string) error {
	n, err := execAffected(ctx, s.client, deleteSettingStmt,
		path, owner.ProjectID, owner.TeamID, owner.ApplicationID, owner.UserID,
	)
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

func scanSetting(rows *sql.Rows) (*settings.SettingStorage, error) {
	var (
		row          settings.SettingStorage
		encoded      string
		createdNano  int64
		modifiedNano int64
	)
	if err := rows.Scan(
		&row.Path, &row.ProjectID, &row.TeamID, &row.ApplicationID, &row.UserID,
		&encoded, &row.IsFinal, &createdNano, &modifiedNano,
	); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(encoded), &row.Value); err != nil {
		return nil, err
	}
	row.CreatedAt = timeFromUnixNano(createdNano)
	row.ModifiedAt = timeFromUnixNano(modifiedNano)
	return &row, nil
}

var _ service.SettingsStatements = (*settingsStatements)(nil)
