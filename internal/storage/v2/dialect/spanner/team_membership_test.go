//go:build spanner_integration

package spanner

import (
	"database/sql"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dbtest"
	spannerdialect "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner/migration"
)

func TestTeamMembershipStatements_CRUD(t *testing.T) {
	ctx := t.Context()

	connector, stop, err := dbtest.Spanner(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	cfg, ok := connector.(*spannerdialect.Config)
	require.True(t, ok)

	db, err := sql.Open("spanner", cfg.DSN)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	require.NoError(t, migration.Migrate(ctx, db))

	dialect, err := DecodeConfig(cfg.DSN)
	require.NoError(t, err)
	pool, err := dialect.Connect(ctx)
	require.NoError(t, err)
	t.Cleanup(func() { _ = pool.Close(ctx) })

	stmts := pool.(*Client).Statements()

	projectID := "proj_tm_v2"
	teamID := "team_tm_v2"
	userID := "usr_tm_v2"
	schemaURL := "https://schemas.test/team-membership/v1.json"

	require.NoError(t, stmts.CreateProject(ctx, &domain.Project{
		ID:             projectID,
		PreviewOrigins: []string{},
	}))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(ctx, projectID) })

	_, err = db.ExecContext(ctx,
		`INSERT INTO json_schemas (project_id, url, payload) VALUES (?, ?, ?)`,
		projectID, schemaURL, "{}",
	)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx,
		`INSERT INTO teams (project_id, id, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
		projectID, teamID,
	)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx,
		`INSERT INTO users (project_id, schema_url, id, status, created_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
		projectID, schemaURL, userID, domain.UserStatusActive.String(),
	)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, `DELETE FROM team_memberships WHERE project_id = ?`, projectID)
		_, _ = db.ExecContext(ctx, `DELETE FROM users WHERE project_id = ?`, projectID)
		_, _ = db.ExecContext(ctx, `DELETE FROM teams WHERE project_id = ?`, projectID)
		_, _ = db.ExecContext(ctx, `DELETE FROM json_schemas WHERE project_id = ?`, projectID)
	})

	membership := &domain.TeamMembership{
		ProjectID: projectID,
		TeamID:    teamID,
		UserID:    userID,
		Status:    domain.MembershipStatusActive,
	}
	require.NoError(t, stmts.CreateTeamMembership(ctx, membership))
	assert.False(t, membership.CreatedAt.IsZero())
	assert.False(t, membership.UpdatedAt.IsZero())

	got, err := stmts.GetTeamMembership(ctx, projectID, teamID, userID)
	require.NoError(t, err)
	assert.Equal(t, domain.MembershipStatusActive, got.Status)
	assert.WithinDuration(t, membership.CreatedAt, got.CreatedAt, time.Second)

	byUser, err := stmts.ListTeamMembershipsByUser(ctx, projectID, userID)
	require.NoError(t, err)
	require.Len(t, byUser, 1)

	byTeam, err := stmts.ListTeamMembershipsByTeam(ctx, projectID, teamID)
	require.NoError(t, err)
	require.Len(t, byTeam, 1)

	require.NoError(t, stmts.UpdateTeamMembershipStatus(ctx, projectID, teamID, userID, domain.MembershipStatusRemoved))
	updated, err := stmts.GetTeamMembership(ctx, projectID, teamID, userID)
	require.NoError(t, err)
	assert.Equal(t, domain.MembershipStatusRemoved, updated.Status)

	_, err = stmts.GetTeamMembership(ctx, "missing", "missing", "missing")
	require.Error(t, err)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}
