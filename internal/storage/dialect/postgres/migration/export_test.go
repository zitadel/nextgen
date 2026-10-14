package migration

import (
	"context"
	"database/sql"
)

// MigrateUpTo applies the migrations up to and including version, so a test
// can seed rows into the schema a later data migration finds.
func MigrateUpTo(ctx context.Context, db *sql.DB, version int64) error {
	locker := migrationSessionLocker{}
	if err := createSchema(ctx, db, locker); err != nil {
		return err
	}
	p, err := newProvider(db, locker)
	if err != nil {
		return err
	}
	_, err = p.UpTo(ctx, version)
	return err
}
