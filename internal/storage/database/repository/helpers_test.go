package repository_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
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

func ensureUser(t *testing.T, client database.QueryExecutor, projectID, teamID, schemaURL, userID string) {
	t.Helper()
	ensureTeam(t, client, projectID, teamID)
	ensureJSONSchemaRow(t, client, projectID, schemaURL, []byte("{}"))
	ctx := t.Context()
	var err error
	if isSpannerDB {
		_, err = client.Exec(ctx,
			`INSERT OR IGNORE INTO users (project_id, schema_url, id, team_id, created_at, updated_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
			projectID, schemaURL, userID, teamID,
		)
	} else {
		_, err = client.Exec(ctx,
			`INSERT INTO zitadel_nextgen.users (project_id, schema_url, id, team_id) VALUES ($1, $2, $3, $4) ON CONFLICT (project_id, id) DO NOTHING`,
			projectID, schemaURL, userID, teamID,
		)
	}
	require.NoError(t, err)
}

func deleteUser(t *testing.T, client database.QueryExecutor, projectID, userID string) {
	t.Helper()
	ctx := t.Context()
	if isSpannerDB {
		_, err := client.Exec(ctx, `DELETE FROM users WHERE project_id = $1 AND id = $2`, projectID, userID)
		require.NoError(t, err)
		return
	}
	userRepo := repository.NewUserRepository()
	require.NoError(t, userRepo.Delete(ctx, client, userRepo.PrimaryKeyCondition(projectID, userID)))
}
