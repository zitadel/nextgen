package migration

import (
	"database/sql"
	"net/url"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	_ "modernc.org/sqlite" // registers the "sqlite" database/sql driver the dialect migrates through
)

// TestMigrationsRoundTrip walks every migration up, all the way down and up
// again. Migrate alone only ever proves the Up direction; this is what proves
// each Down restores the shape the Up before it left, so a release can be
// rolled back.
//
// No build tag: SQLite needs no container, so the walk is as cheap as any
// unit test and runs with them.
func TestMigrationsRoundTrip(t *testing.T) {
	ctx := t.Context()

	// Foreign keys on, as the dialect opens every connection: with them on, a
	// DROP TABLE is also an implicit DELETE the keys get to object to, which
	// is the behaviour a rollback runs under.
	dsn := &url.URL{
		Scheme:   "file",
		Path:     filepath.ToSlash(filepath.Join(t.TempDir(), "roundtrip.db")),
		RawQuery: "_pragma=foreign_keys(1)",
	}
	db, err := sql.Open("sqlite", dsn.String())
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
