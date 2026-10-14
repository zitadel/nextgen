package migration

import (
	"context"
	"database/sql"
)

// MigrateUpTo applies the migrations up to and including version, so a test
// can seed rows into the schema a later data migration finds.
func MigrateUpTo(ctx context.Context, sqlDB *sql.DB, version int64) error {
	p, err := newProvider(sqlDB)
	if err != nil {
		return err
	}
	_, err = p.UpTo(ctx, version)
	return err
}
