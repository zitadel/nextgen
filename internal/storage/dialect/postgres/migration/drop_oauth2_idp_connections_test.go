//go:build postgres_integration

package migration_test

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	migrationpkg "github.com/zitadel/nextgen/internal/storage/dialect/postgres/migration"
	"github.com/zitadel/nextgen/internal/storage/testdb"
)

// 000029 deletes every connection with an oauth2 revision, together with its
// identity links and scope index row, and leaves an oidc connection alone.
func TestDropOAuth2IDPConnections(t *testing.T) {
	ctx := t.Context()
	db := freshDatabase(t)

	require.NoError(t, migrationpkg.MigrateUpTo(ctx, db, 28))

	for _, stmt := range []string{
		`INSERT INTO zitadel_nextgen.projects (id, name, preview_origins) VALUES ('prj_mig', 'mig', '{}')`,
		`INSERT INTO zitadel_nextgen.json_schemas (project_id, url, object_type, kind, payload)
			VALUES ('prj_mig', 'urn:mig', NULL, 'unknown', '{}')`,
		`INSERT INTO zitadel_nextgen.users (project_id, id, schema_url, status)
			VALUES ('prj_mig', 'usr_mig', 'urn:mig', 'active')`,
		`INSERT INTO zitadel_nextgen.idp_connections (project_id, id, slug)
			VALUES ('prj_mig', 'idp_oauth2', 'github'), ('prj_mig', 'idp_oidc', 'google')`,
		`INSERT INTO zitadel_nextgen.idp_connection_revisions (project_id, id, connection_id, document, created_at) VALUES
			('prj_mig', 'rev_oauth2_1', 'idp_oauth2', '{"slug":"github","protocol":"oauth2"}', '2026-01-01T00:00:00Z'),
			('prj_mig', 'rev_oauth2_2', 'idp_oauth2', '{"slug":"github","protocol":"oauth2","display_name":"GitHub"}', '2026-01-02T00:00:00Z'),
			('prj_mig', 'rev_oidc_1', 'idp_oidc', '{"slug":"google","protocol":"oidc"}', '2026-01-01T00:00:00Z')`,
		`INSERT INTO zitadel_nextgen.idp_identity_links (project_id, id, connection_id, subject, user_id) VALUES
			('prj_mig', 'lnk_oauth2', 'idp_oauth2', 'gh-1', 'usr_mig'),
			('prj_mig', 'lnk_oidc', 'idp_oidc', 'g-1', 'usr_mig')`,
		`INSERT INTO zitadel_nextgen.resource_scope_index (resource_id, resource_kind, project_id) VALUES
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
		ids(`SELECT id FROM zitadel_nextgen.idp_connections WHERE project_id = 'prj_mig' ORDER BY id`))
	assert.Equal(t, []string{"rev_oidc_1"},
		ids(`SELECT id FROM zitadel_nextgen.idp_connection_revisions WHERE project_id = 'prj_mig' ORDER BY id`))
	assert.Equal(t, []string{"lnk_oidc"},
		ids(`SELECT id FROM zitadel_nextgen.idp_identity_links WHERE project_id = 'prj_mig' ORDER BY id`))
	assert.Equal(t, []string{"idp_oidc"},
		ids(`SELECT resource_id FROM zitadel_nextgen.resource_scope_index
			WHERE project_id = 'prj_mig' AND resource_kind = 'idp_connection' ORDER BY resource_id`))
	assert.Equal(t, []string{"usr_mig"},
		ids(`SELECT id FROM zitadel_nextgen.users WHERE project_id = 'prj_mig'`))
}

// freshDatabase creates an empty database on the test server, so migrating it
// to an older version is not undone by a shared database that is already
// migrated further.
func freshDatabase(t *testing.T) *sql.DB {
	t.Helper()
	ctx := t.Context()

	dsn, stop, err := testdb.PostgresDSN(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	admin, err := sql.Open("pgx", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = admin.Close() })

	name := fmt.Sprintf("migration_%d", time.Now().UnixNano())
	_, err = admin.ExecContext(ctx, "CREATE DATABASE "+name)
	require.NoError(t, err)

	u, err := url.Parse(dsn)
	require.NoError(t, err)
	u.Path = "/" + name
	db, err := sql.Open("pgx", u.String())
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = db.Close()
		_, _ = admin.ExecContext(context.Background(), "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
	})
	return db
}
