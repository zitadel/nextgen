package sqlite

import (
	"database/sql"
	"errors"

	libsqlite "modernc.org/sqlite"

	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// SQLite extended error codes for constraint violations.
// Reference: https://www.sqlite.org/rescode.html
const (
	sqliteConstraintCheck      = 275  // SQLITE_CONSTRAINT_CHECK       (19 | 1<<8)
	sqliteConstraintForeignKey = 787  // SQLITE_CONSTRAINT_FOREIGNKEY  (19 | 3<<8)
	sqliteConstraintUnique     = 2067 // SQLITE_CONSTRAINT_UNIQUE      (19 | 4<<8)
	sqliteConstraintNotNull    = 1299 // SQLITE_CONSTRAINT_NOTNULL     (19 | 5<<8)
	sqliteConstraintPrimaryKey = 1555 // SQLITE_CONSTRAINT_PRIMARYKEY  (19 | 6<<8)
)

var errTooManyRows = errors.New("sqlite: multiple rows in result set")

func wrapError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return database.NewNoRowFoundError(err)
	}
	if errors.Is(err, errTooManyRows) {
		return database.NewMultipleRowsFoundError(err)
	}

	var sqliteErr *libsqlite.Error
	if errors.As(err, &sqliteErr) {
		switch sqliteErr.Code() {
		case sqliteConstraintUnique, sqliteConstraintPrimaryKey:
			return database.NewUniqueError("", "", err)
		case sqliteConstraintForeignKey:
			return database.NewForeignKeyError("", "", err)
		case sqliteConstraintCheck:
			return database.NewCheckError("", "", err)
		case sqliteConstraintNotNull:
			return database.NewNotNullError("", "", err)
		}
		// Remaining SQLITE_CONSTRAINT_* extended codes (trigger, etc.).
		if sqliteErr.Code()&0xFF == 19 {
			return database.NewCheckError("", "", err)
		}
	}

	return database.NewUnknownError(err)
}
