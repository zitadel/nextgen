//go:build spanner_integration

package spanner

import (
	"context"
	"database/sql"

	spannermigration "github.com/zitadel/nextgen/internal/storage/v2/dialect/spanner/migration"
)

// Migrate implements [database.Pool].
func (c *Client) Migrate(ctx context.Context) error {
	if c.isMigrated {
		return nil
	}

	// goose migrations run through database/sql using the go-sql-spanner
	// driver; the driver is registered by the migration package itself when
	// built with spanner_integration.
	db, err := sql.Open("spanner", c.dsn)
	if err != nil {
		return wrapError(err)
	}
	defer db.Close()

	if err := db.PingContext(ctx); err != nil {
		return wrapError(err)
	}

	err = spannermigration.Migrate(ctx, db)
	c.isMigrated = err == nil
	return wrapError(err)
}
