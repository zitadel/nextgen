//go:build spanner_integration

package spanner

import (
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dbtest"
	spannerdialect "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner/migration"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

// testClient is a v2 spanner client connected to the migrated test database,
// shared across the tests in this package.
var testClient *Client

func TestMain(m *testing.M) {
	code, err := run(m)
	if err != nil {
		slog.Error("spanner test setup failed", "error", err)
	}
	os.Exit(code)
}

func run(m *testing.M) (int, error) {
	ctx := context.Background()

	connector, stop, err := dbtest.Spanner(ctx)
	if err != nil {
		return 1, err
	}
	defer stop()

	cfg, ok := connector.(*spannerdialect.Config)
	if !ok {
		return 1, fmt.Errorf("expected *spanner.Config connector, got %T", connector)
	}

	db, err := sql.Open("spanner", cfg.DSN)
	if err != nil {
		return 1, err
	}
	defer db.Close()
	if err := migration.Migrate(ctx, db); err != nil {
		return 1, err
	}

	dialect, err := DecodeConfig(cfg.DSN)
	if err != nil {
		return 1, err
	}
	pool, err := dialect.Connect(ctx)
	if err != nil {
		return 1, err
	}
	defer pool.Close(ctx)

	c, ok := pool.(*Client)
	if !ok {
		return 1, fmt.Errorf("expected *Client from the v2 spanner dialect, got %T", pool)
	}
	testClient = c

	return m.Run(), nil
}

// uniqueProjectID returns a collision-free project ID scoped to the running
// (sub)test. The v2 statements commit immediately (no rollback), so isolation
// relies on unique IDs plus DeleteProjectByID cleanup rather than a transaction.
func uniqueProjectID(t *testing.T) string {
	t.Helper()
	return "proj-" + strings.ReplaceAll(t.Name(), "/", "_") + "-" + strconv.FormatInt(time.Now().UnixNano(), 10)
}

func newTestProject(id string) *domain.Project {
	return &domain.Project{ID: id, Name: "project-" + rand.Text(), PreviewOrigins: []string{}}
}

func projectIDs(projects []*domain.Project) []string {
	ids := make([]string, len(projects))
	for i, p := range projects {
		ids[i] = p.ID
	}
	return ids
}

func TestProjectStatements_Create(t *testing.T) {
	stmts := testClient.Statements()

	t.Run("creates project and persists fields", func(t *testing.T) {
		project := &domain.Project{
			ID:             uniqueProjectID(t),
			Name:           "project-" + rand.Text(),
			PreviewOrigins: []string{"*.example.com", "localhost:3000"},
		}
		t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), project.ID) })
		require.NoError(t, stmts.CreateProject(t.Context(), project))
		assert.False(t, project.CreatedAt.IsZero())
		assert.False(t, project.UpdatedAt.IsZero())

		got, err := stmts.GetProjectByID(t.Context(), project.ID)
		require.NoError(t, err)
		assert.Equal(t, project.ID, got.ID)
		assert.Equal(t, project.Name, got.Name)
		assert.Equal(t, project.PreviewOrigins, got.PreviewOrigins)
		assert.Equal(t, project.CreatedAt.UTC(), got.CreatedAt.UTC())
		assert.Equal(t, project.UpdatedAt.UTC(), got.UpdatedAt.UTC())
	})

	t.Run("duplicate ID returns error", func(t *testing.T) {
		project := newTestProject(uniqueProjectID(t))
		t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), project.ID) })
		require.NoError(t, stmts.CreateProject(t.Context(), project))

		err := stmts.CreateProject(t.Context(), newTestProject(project.ID))
		assert.ErrorIs(t, err, new(database.UniqueError))
	})
}

func TestProjectStatements_Get(t *testing.T) {
	stmts := testClient.Statements()

	t.Run("returns project by ID", func(t *testing.T) {
		project := newTestProject(uniqueProjectID(t))
		t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), project.ID) })
		require.NoError(t, stmts.CreateProject(t.Context(), project))

		got, err := stmts.GetProjectByID(t.Context(), project.ID)
		require.NoError(t, err)
		assert.Equal(t, project.ID, got.ID)
		assert.Equal(t, project.Name, got.Name)
		assert.False(t, got.CreatedAt.IsZero())
		assert.False(t, got.UpdatedAt.IsZero())
	})

	t.Run("not found returns NoRowFoundError", func(t *testing.T) {
		_, err := stmts.GetProjectByID(t.Context(), uniqueProjectID(t))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestProjectStatements_Update(t *testing.T) {
	stmts := testClient.Statements()

	t.Run("updates name and refreshes updated_at", func(t *testing.T) {
		project := newTestProject(uniqueProjectID(t))
		t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), project.ID) })
		require.NoError(t, stmts.CreateProject(t.Context(), project))
		createdUpdatedAt := project.UpdatedAt

		projectName := "project-" + rand.Text()
		project.Name = projectName
		require.NoError(t, stmts.UpdateProject(t.Context(), project))
		assert.False(t, project.UpdatedAt.Before(createdUpdatedAt))

		got, err := stmts.GetProjectByID(t.Context(), project.ID)
		require.NoError(t, err)
		assert.Equal(t, projectName, got.Name)
		assert.Equal(t, project.UpdatedAt.UTC(), got.UpdatedAt.UTC())
	})

	t.Run("not found returns NoRowFoundError", func(t *testing.T) {
		project := newTestProject(uniqueProjectID(t))
		err := stmts.UpdateProject(t.Context(), project)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestProjectStatements_Delete(t *testing.T) {
	stmts := testClient.Statements()

	t.Run("deletes an existing project", func(t *testing.T) {
		project := newTestProject(uniqueProjectID(t))
		t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), project.ID) })
		require.NoError(t, stmts.CreateProject(t.Context(), project))

		require.NoError(t, stmts.DeleteProjectByID(t.Context(), project.ID))

		_, err := stmts.GetProjectByID(t.Context(), project.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})

	t.Run("deleting a missing project is a no-op", func(t *testing.T) {
		assert.NoError(t, stmts.DeleteProjectByID(t.Context(), uniqueProjectID(t)))
	})
}

func TestProjectStatements_List(t *testing.T) {
	stmts := testClient.Statements()

	ids := []string{"proj_v2_list_0", "proj_v2_list_1", "proj_v2_list_2"}
	projects := make([]*domain.Project, len(ids))
	for i, id := range ids {
		if i > 0 {
			time.Sleep(2 * time.Millisecond)
		}
		project := &domain.Project{ID: id, Name: "project-" + id, PreviewOrigins: []string{}}
		t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), id) })
		require.NoError(t, stmts.CreateProject(t.Context(), project))
		projects[i] = project
	}

	createdAtCol := v2database.Col(domain.ProjectFieldCreatedAt)
	list := func(t *testing.T, filter v2database.Filter[domain.ProjectField], dir v2database.OrderDirection) []string {
		t.Helper()
		res, err := stmts.ListProjects(t.Context(), &v2database.ListOptions[domain.ProjectField]{
			Filter: filter,
			Pagination: v2database.Page[domain.ProjectField]{
				OrderBy: v2database.OrderBy[domain.ProjectField]{
					Columns:   []v2database.Column[domain.ProjectField]{createdAtCol},
					Direction: dir,
				},
			},
		})
		require.NoError(t, err)
		return projectIDs(res.Items)
	}

	t.Run("filters by created_at equal", func(t *testing.T) {
		assert.Equal(t, []string{ids[1]}, list(t, v2database.Equal(createdAtCol, projects[1].CreatedAt), v2database.OrderAsc))
	})

	t.Run("filters by created_at greater than", func(t *testing.T) {
		assert.Equal(t, []string{ids[2]}, list(t, v2database.GreaterThan(createdAtCol, projects[1].CreatedAt), v2database.OrderAsc))
	})

	t.Run("filters by created_at less than", func(t *testing.T) {
		assert.Equal(t, []string{ids[0]}, list(t, v2database.LessThan(createdAtCol, projects[1].CreatedAt), v2database.OrderAsc))
	})

	t.Run("sorts by created_at ascending", func(t *testing.T) {
		assert.Equal(t, []string{ids[0], ids[1], ids[2]}, list(t, nil, v2database.OrderAsc))
	})

	t.Run("sorts by created_at descending", func(t *testing.T) {
		assert.Equal(t, []string{ids[2], ids[1], ids[0]}, list(t, nil, v2database.OrderDesc))
	})

	t.Run("paginates with a cursor", func(t *testing.T) {
		page := v2database.Page[domain.ProjectField]{
			Limit: 2,
			OrderBy: v2database.OrderBy[domain.ProjectField]{
				Columns:   []v2database.Column[domain.ProjectField]{createdAtCol},
				Direction: v2database.OrderAsc,
			},
		}

		first, err := stmts.ListProjects(t.Context(), &v2database.ListOptions[domain.ProjectField]{Pagination: page})
		require.NoError(t, err)
		assert.Equal(t, []string{ids[0], ids[1]}, projectIDs(first.Items))
		require.NotEmpty(t, first.NextCursor)

		page.Cursor = first.NextCursor
		second, err := stmts.ListProjects(t.Context(), &v2database.ListOptions[domain.ProjectField]{Pagination: page})
		require.NoError(t, err)
		assert.Equal(t, []string{ids[2]}, projectIDs(second.Items))
		assert.Empty(t, second.NextCursor)
	})
}
