//go:build spanner_integration

package dbtest

import (
	"context"
	"os"

	"github.com/zitadel/nextgen/internal/storage/database"
	spannerdialect "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
	spannerembedded "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner/embedded"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner/testdb"
)

// Spanner returns a connector for the Spanner integration tests. Precedence:
// if ZITADEL_TEST_SPANNER_INSTANCE is set it provisions a fresh, uniquely named
// database on that shared instance (the returned stop drops it); else if
// ZITADEL_TEST_SPANNER_URL is set it connects to that database; otherwise it
// starts a Cloud Spanner emulator testcontainer. The returned stop is always
// non-nil and safe to defer.
func Spanner(ctx context.Context) (database.Connector, func(), error) {
	if os.Getenv(testdb.InstanceEnv) != "" {
		return testdb.Provision(ctx)
	}
	if url := os.Getenv("ZITADEL_TEST_SPANNER_URL"); url != "" {
		connector, err := spannerdialect.DecodeConfig(url)
		return connector, func() {}, err
	}
	connector, stop, err := spannerembedded.StartEmbedded(ctx)
	if stop == nil {
		stop = func() {}
	}
	return connector, stop, err
}
