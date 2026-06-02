//go:build spanner_integration

package dbtest

import (
	"context"
	"os"

	"github.com/zitadel/nextgen/internal/storage/database"
	spannerdialect "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
	spannerembedded "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner/embedded"
)

// Spanner returns a connector for the Spanner integration tests. If
// ZITADEL_TEST_SPANNER_URL is set it connects to that database (no Docker
// required); otherwise it starts a Cloud Spanner emulator testcontainer. The
// returned stop is always non-nil and safe to defer.
func Spanner(ctx context.Context) (database.Connector, func(), error) {
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
