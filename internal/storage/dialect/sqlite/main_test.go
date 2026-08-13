//go:build sqlite_integration

package sqlite

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

var testPool *Pool

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

func runTests(m *testing.M) int {
	dir, err := os.MkdirTemp("", "zitadel-sqlite-integration-*")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(dir)

	path := filepath.Join(dir, "test.db")
	dialect := Config{Path: path}
	pool, err := dialect.Connect(context.Background())
	if err != nil {
		panic(err)
	}
	p := pool.(*Pool)
	defer func() { _ = p.Close(context.Background()) }()
	if err := p.Migrate(context.Background()); err != nil {
		panic(err)
	}
	testPool = p
	return m.Run()
}

func TestProjectCRUD(t *testing.T) {
	ctx := t.Context()
	id := "proj-" + t.Name()
	project := &domain.Project{
		ID:             id,
		Name:           "Test Project",
		PreviewOrigins: []string{"https://preview.example"},
	}
	require.NoError(t, testPool.CreateProject(ctx, project))
	require.False(t, project.CreatedAt.IsZero())
	require.False(t, project.UpdatedAt.IsZero())

	got, err := testPool.GetProjectByID(ctx, id)
	require.NoError(t, err)
	require.Equal(t, project.Name, got.Name)
	require.Equal(t, project.PreviewOrigins, got.PreviewOrigins)

	project.Name = "Renamed"
	require.NoError(t, testPool.UpdateProject(ctx, project))
	got, err = testPool.GetProjectByID(ctx, id)
	require.NoError(t, err)
	require.Equal(t, "Renamed", got.Name)

	list, err := testPool.ListProjects(ctx, &database.ListOptions[domain.ProjectField]{
		Filter: database.Equal(database.Col(domain.ProjectFieldID), id),
		Pagination: database.Page[domain.ProjectField]{
			OrderBy: database.OrderBy[domain.ProjectField]{
				Columns: []database.Column[domain.ProjectField]{database.Col(domain.ProjectFieldID)},
			},
		},
	})
	require.NoError(t, err)
	require.Len(t, list.Items, 1)

	_, err := testPool.DeleteProjectByID(ctx, id)
	require.NoError(t, err)
	_, err = testPool.GetProjectByID(ctx, id)
	require.Error(t, err)
}

func TestTeamNameUniqueness(t *testing.T) {
	ctx := t.Context()
	projectID := "proj-team-" + t.Name()
	require.NoError(t, testPool.CreateProject(ctx, &domain.Project{ID: projectID, Name: "p"}))
	t.Cleanup(func() { _, _ = testPool.DeleteProjectByID(context.Background(), projectID) })

	require.NoError(t, testPool.CreateTeam(ctx, &domain.Team{ProjectID: projectID, ID: "t1", Name: "Engineering"}))
	err := testPool.CreateTeam(ctx, &domain.Team{ProjectID: projectID, ID: "t2", Name: "engineering"})
	require.Error(t, err)
}
