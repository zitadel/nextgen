package repository_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// skipIfSpanner skips the test when the suite runs against Spanner. Use for repositories
// that are not yet implemented for the GoogleSQL dialect (for example user credentials).
func skipIfSpanner(t *testing.T) {
	t.Helper()
	if isSpannerDB {
		t.Skip("not implemented for Spanner yet")
	}
}

func ensureProject(t *testing.T, client database.QueryExecutor, projectID string) {
	t.Helper()
	ctx := t.Context()
	var err error
	if isSpannerDB {
		_, err = client.Exec(ctx,
			`INSERT OR IGNORE INTO projects (id, created_at, updated_at) VALUES ($1, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
			projectID,
		)
	} else {
		_, err = client.Exec(ctx,
			`INSERT INTO zitadel_nextgen.projects (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
			projectID,
		)
	}
	require.NoError(t, err)
}

func ensureTeam(t *testing.T, client database.QueryExecutor, projectID, teamID string) {
	t.Helper()
	ensureProject(t, client, projectID)
	ctx := t.Context()
	var err error
	if isSpannerDB {
		_, err = client.Exec(ctx,
			`INSERT OR IGNORE INTO teams (project_id, id, created_at, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
			projectID, teamID,
		)
	} else {
		_, err = client.Exec(ctx,
			`INSERT INTO zitadel_nextgen.teams (project_id, id) VALUES ($1, $2) ON CONFLICT (project_id, id) DO NOTHING`,
			projectID, teamID,
		)
	}
	require.NoError(t, err)
}

func ensureJSONSchemaRow(t *testing.T, client database.QueryExecutor, projectID, schemaURL string, payload []byte) {
	t.Helper()
	ensureProject(t, client, projectID)
	ctx := t.Context()
	var err error
	if isSpannerDB {
		_, err = client.Exec(ctx,
			`INSERT OR IGNORE INTO json_schemas (project_id, url, payload) VALUES ($1, $2, $3)`,
			projectID, schemaURL, string(payload),
		)
	} else {
		_, err = client.Exec(ctx,
			`INSERT INTO zitadel_nextgen.json_schemas (project_id, url, payload) VALUES ($1, $2, $3::json) ON CONFLICT (project_id, url) DO NOTHING`,
			projectID, schemaURL, payload,
		)
	}
	require.NoError(t, err)
}

