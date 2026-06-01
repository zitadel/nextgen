//go:build postgres_integration || spanner_integration

// The spanner_integration tag is included because shared repository tests run under both backend tags and call dbtest.Postgres.
package dbtest

import (
	"context"
	"os"

	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	pgembedded "github.com/zitadel/nextgen/internal/storage/database/dialect/postgres/embedded"
)

// Postgres returns a connector for the Postgres integration tests. If
// ZITADEL_TEST_POSTGRES_URL is set it connects to that database (no Docker
// required); otherwise it starts a Postgres testcontainer. The returned stop
// is always non-nil and safe to defer.
func Postgres(ctx context.Context) (database.Connector, func(), error) {
	if url := os.Getenv("ZITADEL_TEST_POSTGRES_URL"); url != "" {
		connector, err := postgres.DecodeConfig(url)
		return connector, func() {}, err
	}
	connector, stop, err := pgembedded.StartContainer(ctx)
	if stop == nil {
		stop = func() {}
	}
	return connector, stop, err
}
