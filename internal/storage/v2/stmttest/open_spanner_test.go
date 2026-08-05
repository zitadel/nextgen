//go:build spanner_integration

package stmttest

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/v2/dbtest"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/spanner"
)

func init() {
	registerDialect("spanner", dbtest.Spanner, func(ctx context.Context, pool dbtest.Pool, ids []string, createdAt time.Time) error {
		return spanner.SeedProjectsTiedAt(ctx, pool, ids, createdAt)
	})
}
