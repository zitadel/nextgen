//go:build sqlite_integration

package stmttest

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/v2/dbtest"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/sqlite"
)

func init() {
	registerDialect("sqlite", dbtest.SQLite, func(ctx context.Context, pool dbtest.Pool, ids []string, createdAt time.Time) error {
		return sqlite.SeedProjectsTiedAt(ctx, pool, ids, createdAt)
	})
}
