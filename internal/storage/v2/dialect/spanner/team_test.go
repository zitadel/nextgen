//go:build spanner_integration

package spanner

import (
	"context"
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dbtest"
	spannerdialect "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner/migration"
)

func TestTeamStatements_CRUD(t *testing.T) {
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

	client := pool.(*Client)
	stmts := client.Statements()

	project := &domain.Project{
		ID:             "proj_v2_team",
		ProjectSecret:  "project-secret",
		PreviewSecret:  "preview-secret",
		PreviewOrigins: []string{},
	}
	require.NoError(t, stmts.CreateProject(ctx, project))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(ctx, project.ID) })

	team := &domain.Team{ProjectID: project.ID, ID: "team_v2_crud"}
	require.NoError(t, stmts.CreateTeam(ctx, team))
	assert.Equal(t, domain.TeamStatusActive, team.Status)
	assert.False(t, team.CreatedAt.IsZero())
	assert.False(t, team.UpdatedAt.IsZero())

	got, err := stmts.GetTeamByID(ctx, project.ID, team.ID)
	require.NoError(t, err)
	assert.Equal(t, team.ID, got.ID)
	assert.Equal(t, project.ID, got.ProjectID)
	assert.Equal(t, domain.TeamStatusActive, got.Status)

	require.NoError(t, client.Transaction(ctx, func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		return tx.Statements().DeactivateTeam(ctx, project.ID, team.ID)
	}))

	got, err = stmts.GetTeamByID(ctx, project.ID, team.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.TeamStatusDeactivated, got.Status)

	_, err = stmts.GetTeamByID(ctx, project.ID, "missing")
	require.Error(t, err)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}
