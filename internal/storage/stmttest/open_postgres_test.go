//go:build postgres_integration

package stmttest

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/dbtest"
	"github.com/zitadel/nextgen/internal/storage/dialect/postgres"
)

func init() {
	registerDialect(
		"postgres",
		dbtest.Postgres,
		func(ctx context.Context, pool dbtest.Pool, ids []string, createdAt time.Time) error {
			return postgres.SeedProjectsTiedAt(ctx, pool, ids, createdAt)
		},
		func(ctx context.Context, pool dbtest.Pool, projectID, teamID string) error {
			return postgres.HardDeleteTeam(ctx, pool, projectID, teamID)
		},
		postgres.SchemaColumnNullability(),
		func(ctx context.Context, pool dbtest.Pool) (map[string]map[string]bool, error) {
			return postgres.LiveColumnNullability(ctx, pool)
		},
	)
}
