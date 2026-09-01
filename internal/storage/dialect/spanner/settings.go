package spanner

import (
	"context"
	"encoding/json"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/settings"
)

const (
	settingsQuery = `SELECT path, project_id, team_id, application_id, user_id, value, is_final, created_at, modified_at
FROM settings`

	// INSERT OR UPDATE keys on the primary key, which is the natural key here,
	// so a rewrite at the same owner replaces the leaf instead of adding a
	// second one at that level.
	setSettingStmt = `INSERT OR UPDATE INTO settings (path, project_id, team_id, application_id, user_id, value, is_final, modified_at)
VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, CURRENT_TIMESTAMP())`

	// Every owner column is matched exactly, so this can only remove the leaf
	// the caller owns -- never one it merely inherits.
	deleteSettingStmt = `DELETE FROM settings
WHERE path = @p1 AND project_id = @p2 AND team_id = @p3 AND application_id = @p4 AND user_id = @p5`
)

type settingsStatements struct{ statement }

func newSettingsStatements(db queryExecutor) settingsStatements {
	return settingsStatements{statement: statement{db: db}}
}

// GetSettings implements [service.SettingsStatements].
func (s settingsStatements) GetSettings(ctx context.Context, requester domain.SettingOwner, paths ...string) ([]*domain.Setting, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, settingsQuery, settings.VisibleTo(requester, paths...), settings.Schema); err != nil {
		return nil, err
	}

	var items []*settings.SettingStorage
	if err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, scanSetting)
		return err
	}); err != nil {
		return nil, returnQueryError(err)
	}
	return settings.ToDomain(items), nil
}

// SetSetting implements [service.SettingsStatements].
func (s settingsStatements) SetSetting(ctx context.Context, owner domain.SettingOwner, path string, value any, isFinal bool) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	stmt := buildStatement(setSettingStmt,
		path, owner.ProjectID, owner.TeamID, owner.ApplicationID, owner.UserID,
		spanner.NullJSON{Value: json.RawMessage(encoded), Valid: true}, isFinal,
	).statement()
	if _, err := s.db.Update(ctx, stmt); err != nil {
		return wrapError(err)
	}
	return nil
}

// DeleteSetting implements [service.SettingsStatements].
func (s settingsStatements) DeleteSetting(ctx context.Context, owner domain.SettingOwner, path string) error {
	stmt := buildStatement(deleteSettingStmt,
		path, owner.ProjectID, owner.TeamID, owner.ApplicationID, owner.UserID,
	).statement()
	n, err := s.db.Update(ctx, stmt)
	if err != nil {
		return wrapError(err)
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

func scanSetting(row *spanner.Row) (*settings.SettingStorage, error) {
	var (
		stored     settings.SettingStorage
		encoded    spanner.NullJSON
		createdAt  time.Time
		modifiedAt time.Time
	)
	if err := row.Columns(
		&stored.Path, &stored.ProjectID, &stored.TeamID, &stored.ApplicationID, &stored.UserID,
		&encoded, &stored.IsFinal, &createdAt, &modifiedAt,
	); err != nil {
		return nil, err
	}
	raw, err := decodeNullJSON(encoded)
	if err != nil {
		return nil, err
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &stored.Value); err != nil {
			return nil, err
		}
	}
	stored.CreatedAt = createdAt.UTC()
	stored.ModifiedAt = modifiedAt.UTC()
	return &stored, nil
}

var _ service.SettingsStatements = (*settingsStatements)(nil)
