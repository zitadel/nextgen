package migration

import (
	"context"
	"database/sql"
)

// MigrateUpTo applies the migrations up to and including version, so a test
// can seed rows into the schema a later data migration finds. It skips the
// migration lease: the test owns its database.
func MigrateUpTo(ctx context.Context, db *sql.DB, version int64) error {
	p, err := newProvider(db)
	if err != nil {
		return err
	}
	_, err = p.UpTo(ctx, version)
	return err
}
