//go:build spanner_integration && !postgres_integration

package stmttest

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/v2/dbtest"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/spanner"
)

func openPool(ctx context.Context) (dbtest.Pool, func(), error) {
	return dbtest.Spanner(ctx)
}

func bindSeed(pool dbtest.Pool) func(ctx context.Context, ids []string, createdAt time.Time) error {
	return func(ctx context.Context, ids []string, createdAt time.Time) error {
		return spanner.SeedProjectsTiedAt(ctx, pool, ids, createdAt)
	}
}
