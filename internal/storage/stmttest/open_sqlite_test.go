//go:build sqlite_integration

package stmttest

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/dbtest"
	"github.com/zitadel/nextgen/internal/storage/dialect/sqlite"
)

func init() {
	registerDialect(
		"sqlite",
		dbtest.SQLite,
		func(ctx context.Context, pool dbtest.Pool, ids []string, createdAt time.Time) error {
			return sqlite.SeedProjectsTiedAt(ctx, pool, ids, createdAt)
		},
		func(ctx context.Context, pool dbtest.Pool, projectID, teamID string) error {
			return sqlite.HardDeleteTeam(ctx, pool, projectID, teamID)
		},
		sqlite.SchemaColumnNullability(),
		func(ctx context.Context, pool dbtest.Pool) (map[string]map[string]bool, error) {
			return sqlite.LiveColumnNullability(ctx, pool)
		},
	)
}
