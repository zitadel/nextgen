//go:build spanner_integration

package stmttest

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/dbtest"
	"github.com/zitadel/nextgen/internal/storage/dialect/spanner"
)

func init() {
	registerDialect(
		"spanner",
		dbtest.Spanner,
		func(ctx context.Context, pool dbtest.Pool, ids []string, createdAt time.Time) error {
			return spanner.SeedProjectsTiedAt(ctx, pool, ids, createdAt)
		},
		func(ctx context.Context, pool dbtest.Pool, projectID, teamID string) error {
			return spanner.HardDeleteTeam(ctx, pool, projectID, teamID)
		},
		spanner.SchemaColumnNullability(),
		func(ctx context.Context, pool dbtest.Pool) (map[string]map[string]bool, error) {
			return spanner.LiveColumnNullability(ctx, pool)
		},
	)
}
