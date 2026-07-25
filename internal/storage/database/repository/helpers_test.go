//go:build postgres_integration || spanner_integration

package repository_test

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
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
	// name is NOT NULL; derive it from the project ID.
	name := "project-" + projectID
	var err error
	if isSpannerDB {
		_, err = client.Exec(ctx,
			`INSERT OR IGNORE INTO projects (id, name, created_at, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
			projectID, name,
		)
	} else {
		_, err = client.Exec(ctx,
			`INSERT INTO zitadel_nextgen.projects (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
			projectID, name,
		)
	}
	require.NoError(t, err)
}

// deleteProject deletes a project row directly; the repository package has no
// project repository of its own (project storage lives in v2)
func deleteProject(t *testing.T, client database.QueryExecutor, projectID string) {
	t.Helper()
	ctx := t.Context()
	_, err := client.Exec(ctx, `DELETE FROM `+dbTable("projects")+` WHERE id = $1`, projectID)
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
			`INSERT OR IGNORE INTO users (project_id, schema_url, id, lifecycle_owner_team_id, status, created_at, updated_at) VALUES ($1, $2, $3, NULL, $4, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
			projectID, schemaURL, userID, domain.UserStatusActive.String(),
		)
	} else {
		_, err = client.Exec(ctx,
			`INSERT INTO zitadel_nextgen.users (project_id, schema_url, id, lifecycle_owner_team_id, status) VALUES ($1, $2, $3, NULL, $4) ON CONFLICT (project_id, id) DO NOTHING`,
			projectID, schemaURL, userID, domain.UserStatusActive.String(),
		)
	}
	require.NoError(t, err)
	if teamID == "" {
		return
	}
	createTeamMembership(t, client, projectID, teamID, userID, domain.MembershipStatusActive)
}

func deleteUser(t *testing.T, client database.QueryExecutor, projectID, userID string) {
	t.Helper()
	ctx := t.Context()
	if isSpannerDB {
		_, err := client.Exec(ctx, `DELETE FROM team_memberships WHERE project_id = $1 AND user_id = $2`, projectID, userID)
		require.NoError(t, err)
		_, err = client.Exec(ctx, `DELETE FROM users WHERE project_id = $1 AND id = $2`, projectID, userID)
		require.NoError(t, err)
		return
	}
	userRepo := repository.NewUserRepository()
	require.NoError(t, userRepo.Delete(ctx, client, userRepo.PrimaryKeyCondition(projectID, userID)))
}

func getTeamMembershipStatus(t *testing.T, client database.QueryExecutor, projectID, teamID, userID string) domain.MembershipStatus {
	t.Helper()
	row := client.QueryRow(t.Context(),
		fmt.Sprintf(`SELECT status FROM %s WHERE project_id = $1 AND team_id = $2 AND user_id = $3`, dbTable("team_memberships")),
		projectID, teamID, userID,
	)
	var status string
	require.NoError(t, row.Scan(&status))
	return domain.MembershipStatus(status)
}

func createTeamMembership(t *testing.T, client database.QueryExecutor, projectID, teamID, userID string, status domain.MembershipStatus) {
	t.Helper()
	_, err := client.Exec(t.Context(),
		fmt.Sprintf(`INSERT INTO %s (project_id, team_id, user_id, status) VALUES ($1, $2, $3, $4)`, dbTable("team_memberships")),
		projectID, teamID, userID, status.String(),
	)
	require.NoError(t, err)
}
