//go:build spanner_integration

package spanner

import (
	"context"

	"github.com/zitadel/nextgen/internal/storage/dialect/spanner/migration"
)

// Migrate implements [database.Pool].
func (c *Client) Migrate(ctx context.Context) error {
	if c.isMigrated {
		return nil
	}

	// Not sql.Open("spanner", …): migration.OpenDB returns a *sql.DB whose
	// connections group consecutive DDL into one UpdateDatabaseDdl call, which
	// is what keeps a real-instance boot from spending ~43 minutes in Migrate
	// (#973). goose is unaware of it. The buffering that implies, and how it
	// changes where a bad statement reports its error, is documented on
	// migration.OpenDB.
	db, err := migration.OpenDB(c.dsn)
	if err != nil {
		return wrapError(err)
	}
	defer db.Close()

	if err := db.PingContext(ctx); err != nil {
		return wrapError(err)
	}

	err = migration.Migrate(ctx, db)
	c.isMigrated = err == nil
	return wrapError(err)
}
