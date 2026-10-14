//go:build spanner_integration

package migration_test

import (
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	migrationpkg "github.com/zitadel/nextgen/internal/storage/dialect/spanner/migration"
	"github.com/zitadel/nextgen/internal/storage/testdb"
)

// 000032 deletes every connection with an oauth2 revision, together with its
// identity links and scope index row, and leaves an oidc connection alone.
func TestDropOAuth2IDPConnections(t *testing.T) {
	ctx := t.Context()

	// Without ZITADEL_TEST_SPANNER_URL this is a fresh emulator database, which
	// migrating to an older version needs.
	dsn, stop, err := testdb.SpannerDSN(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)
	db, err := sql.Open("spanner", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	require.NoError(t, migrationpkg.MigrateUpTo(ctx, db, 31))

	for _, stmt := range []string{
		`INSERT INTO projects (id, name, preview_origins) VALUES ('prj_mig', 'mig', '[]')`,
		`INSERT INTO json_schemas (project_id, url, object_type, kind, payload)
			VALUES ('prj_mig', 'urn:mig', NULL, 'unknown', JSON '{}')`,
		`INSERT INTO users (project_id, id, schema_url, status)
			VALUES ('prj_mig', 'usr_mig', 'urn:mig', 'active')`,
		`INSERT INTO idp_connections (project_id, id, slug)
			VALUES ('prj_mig', 'idp_oauth2', 'github'), ('prj_mig', 'idp_oidc', 'google')`,
		`INSERT INTO idp_connection_revisions (project_id, id, connection_id, document, created_at) VALUES
			('prj_mig', 'rev_oauth2_1', 'idp_oauth2', JSON '{"slug":"github","protocol":"oauth2"}', TIMESTAMP '2026-01-01T00:00:00Z'),
			('prj_mig', 'rev_oauth2_2', 'idp_oauth2', JSON '{"slug":"github","protocol":"oauth2","display_name":"GitHub"}', TIMESTAMP '2026-01-02T00:00:00Z'),
			('prj_mig', 'rev_oidc_1', 'idp_oidc', JSON '{"slug":"google","protocol":"oidc"}', TIMESTAMP '2026-01-01T00:00:00Z')`,
		`INSERT INTO idp_identity_links (project_id, id, connection_id, subject, user_id) VALUES
			('prj_mig', 'lnk_oauth2', 'idp_oauth2', 'gh-1', 'usr_mig'),
			('prj_mig', 'lnk_oidc', 'idp_oidc', 'g-1', 'usr_mig')`,
		`INSERT INTO resource_scope_index (resource_id, resource_kind, project_id) VALUES
			('idp_oauth2', 'idp_connection', 'prj_mig'),
			('idp_oidc', 'idp_connection', 'prj_mig')`,
	} {
		_, err := db.ExecContext(ctx, stmt)
		require.NoError(t, err, stmt)
	}

	require.NoError(t, migrationpkg.Migrate(ctx, db))

	ids := func(query string) []string {
		t.Helper()
		rows, err := db.QueryContext(ctx, query)
		require.NoError(t, err, query)
		defer func() { _ = rows.Close() }()
		var got []string
		for rows.Next() {
			var id string
			require.NoError(t, rows.Scan(&id))
			got = append(got, id)
		}
		require.NoError(t, rows.Err())
		return got
	}
	assert.Equal(t, []string{"idp_oidc"},
		ids(`SELECT id FROM idp_connections WHERE project_id = 'prj_mig' ORDER BY id`))
	assert.Equal(t, []string{"rev_oidc_1"},
		ids(`SELECT id FROM idp_connection_revisions WHERE project_id = 'prj_mig' ORDER BY id`))
	assert.Equal(t, []string{"lnk_oidc"},
		ids(`SELECT id FROM idp_identity_links WHERE project_id = 'prj_mig' ORDER BY id`))
	assert.Equal(t, []string{"idp_oidc"},
		ids(`SELECT resource_id FROM resource_scope_index
			WHERE project_id = 'prj_mig' AND resource_kind = 'idp_connection' ORDER BY resource_id`))
	assert.Equal(t, []string{"usr_mig"},
		ids(`SELECT id FROM users WHERE project_id = 'prj_mig'`))
}
