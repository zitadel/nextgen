//go:build postgres_integration

package stmttest

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/v2/dbtest"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres"
)

func init() {
	registerDialect("postgres", dbtest.Postgres, func(ctx context.Context, pool dbtest.Pool, ids []string, createdAt time.Time) error {
		return postgres.SeedProjectsTiedAt(ctx, pool, ids, createdAt)
	})
}
