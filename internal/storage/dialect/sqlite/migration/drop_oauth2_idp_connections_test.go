//go:build sqlite_integration

package migration_test

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	_ "modernc.org/sqlite" // registers the "sqlite" database/sql driver

	migrationpkg "github.com/zitadel/nextgen/internal/storage/dialect/sqlite/migration"
)

// 000019 deletes every connection with an oauth2 revision, together with its
// identity links and scope index row, and leaves an oidc connection alone.
func TestDropOAuth2IDPConnections(t *testing.T) {
	ctx := t.Context()

	// foreign_keys is off by default per connection; the dialect turns it on,
	// and the migration has to hold with it on.
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "mig.db")+"?_pragma=foreign_keys(1)")
	require.NoError(t, err)
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	var foreignKeys int
	require.NoError(t, db.QueryRowContext(ctx, "PRAGMA foreign_keys").Scan(&foreignKeys))
	require.Equal(t, 1, foreignKeys)

	require.NoError(t, migrationpkg.MigrateUpTo(ctx, db, 18))

	for _, stmt := range []string{
		`INSERT INTO projects (id, name, preview_origins, created_at, updated_at) VALUES ('prj_mig', 'mig', '[]', 1, 1)`,
		`INSERT INTO json_schemas (project_id, url, object_type, kind, created_at, payload)
			VALUES ('prj_mig', 'urn:mig', NULL, 'unknown', 1, '{}')`,
		`INSERT INTO users (project_id, id, schema_url, status, created_at, updated_at)
			VALUES ('prj_mig', 'usr_mig', 'urn:mig', 'active', 1, 1)`,
		`INSERT INTO idp_connections (project_id, id, slug, created_at)
			VALUES ('prj_mig', 'idp_oauth2', 'github', 1), ('prj_mig', 'idp_oidc', 'google', 1)`,
		`INSERT INTO idp_connection_revisions (project_id, id, connection_id, document, created_at) VALUES
			('prj_mig', 'rev_oauth2_1', 'idp_oauth2', '{"slug":"github","protocol":"oauth2"}', 1),
			('prj_mig', 'rev_oauth2_2', 'idp_oauth2', '{"slug":"github","protocol":"oauth2","display_name":"GitHub"}', 2),
			('prj_mig', 'rev_oidc_1', 'idp_oidc', '{"slug":"google","protocol":"oidc"}', 1)`,
		`INSERT INTO idp_identity_links (project_id, id, connection_id, subject, user_id, created_at) VALUES
			('prj_mig', 'lnk_oauth2', 'idp_oauth2', 'gh-1', 'usr_mig', 1),
			('prj_mig', 'lnk_oidc', 'idp_oidc', 'g-1', 'usr_mig', 1)`,
		`INSERT INTO resource_scope_index (resource_id, resource_kind, project_id, created_at, updated_at) VALUES
			('idp_oauth2', 'idp_connection', 'prj_mig', 1, 1),
			('idp_oidc', 'idp_connection', 'prj_mig', 1, 1)`,
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
