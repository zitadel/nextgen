//go:build spanner_integration

package spanner

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/storage/dialect/spanner/migration"
)

// Migrate implements [database.Pool].
func (c *Client) Migrate(ctx context.Context) error {
	if c.isMigrated {
		return nil
	}

	// goose uses database/sql via go-sql-spanner (registered by the migration package).
	db, err := sql.Open("spanner", c.dsn)
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
