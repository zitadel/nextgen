//go:build spanner_integration

package migration

import (
	"database/sql"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/storage/testdb"
)

// TestMigrationsRoundTrip walks every migration up, all the way down and up
// again. Migrate alone only ever proves the Up direction; this is what proves
// each Down restores the shape the Up before it left, so a release can be
// rolled back.
//
// The Down direction runs one UpdateDatabaseDdl per statement, since
// batchDDLFS rewrites the Up section only. That is the cost this test pays
// for exercising the path nothing automated takes; on the emulator it is
// cheap.
func TestMigrationsRoundTrip(t *testing.T) {
	if os.Getenv("ZITADEL_TEST_SPANNER_URL") != "" {
		t.Skip("the round trip tears the schema down, which a database shared with other packages cannot afford; it runs against its own emulator")
	}
	ctx := t.Context()

	dsn, stop, err := testdb.SpannerDSN(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	// The "spanner" driver is registered by driver.go under this build tag.
	db, err := sql.Open("spanner", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	require.NoError(t, Migrate(ctx, db))

	p, err := newProvider(db)
	require.NoError(t, err)

	latest, err := p.GetDBVersion(ctx)
	require.NoError(t, err)
	require.NotZero(t, latest, "Migrate must have applied something")

	_, err = p.DownTo(ctx, 0)
	require.NoError(t, err)
	version, err := p.GetDBVersion(ctx)
	require.NoError(t, err)
	assert.Zero(t, version, "every migration must be reversible")

	_, err = p.Up(ctx)
	require.NoError(t, err)
	version, err = p.GetDBVersion(ctx)
	require.NoError(t, err)
	assert.Equal(t, latest, version, "the Down migrations must leave a database the Up ones apply to again")
}
