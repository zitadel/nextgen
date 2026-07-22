//go:build spanner_integration

package spanner

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	"github.com/oklog/ulid/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dbtest"
	spannerdialect "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner/migration"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestProjectStatements_CRUD(t *testing.T) {
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

	// Unique per run: the database may be shared with other test packages and
	// persist across runs, so a fixed ID would collide.
	project := &domain.Project{
		ID:             "proj_v2_crud_" + strings.ReplaceAll(t.Name(), "/", "_") + "_" + ulid.Make().String(),
		PreviewOrigins: []string{"*.example.com", "localhost:3000"},
	}
	require.NoError(t, stmts.CreateProject(ctx, project))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), project.ID) })
	assert.False(t, project.CreatedAt.IsZero())
	assert.False(t, project.UpdatedAt.IsZero())

	got, err := stmts.GetProjectByID(ctx, project.ID)
	require.NoError(t, err)
	assert.Equal(t, project.ID, got.ID)
	assert.Equal(t, project.ProjectSecret, got.ProjectSecret)
	assert.Equal(t, project.PreviewSecret, got.PreviewSecret)
	assert.Equal(t, project.PreviewOrigins, got.PreviewOrigins)
	assert.Equal(t, project.CreatedAt.UTC(), got.CreatedAt.UTC())
	assert.Equal(t, project.UpdatedAt.UTC(), got.UpdatedAt.UTC())

	listed, err := stmts.ListProjects(ctx, &v2database.ListOptions[domain.ProjectField]{
		// Filter to this test's row: foreign projects from other packages
		// sharing the database must not affect the count.
		Filter: v2database.Equal(v2database.Col(domain.ProjectFieldID), project.ID),
		Pagination: v2database.Page[domain.ProjectField]{
			Limit: 10,
			OrderBy: v2database.OrderBy[domain.ProjectField]{
				Columns: []v2database.Column[domain.ProjectField]{v2database.Col(domain.ProjectFieldID)},
			},
		},
	})
	require.NoError(t, err)
	require.Len(t, listed.Items, 1)
	assert.Equal(t, project.ID, listed.Items[0].ID)

	require.NoError(t, stmts.DeleteProjectByID(ctx, project.ID))

	_, err = stmts.GetProjectByID(ctx, project.ID)
	require.Error(t, err)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}
