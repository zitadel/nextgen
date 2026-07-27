//go:build postgres_integration

package postgres

import (
	"context"
	"crypto/rand"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	legacydb "github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestProjectStatements_Create(t *testing.T) {
	t.Run("creates project and timestamps are set", func(t *testing.T) {
		project := newTestProject(uniqueProjectID(t))
		t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), project.ID) })

		require.NoError(t, testPool.CreateProject(t.Context(), project))
		assert.False(t, project.CreatedAt.IsZero())
		assert.False(t, project.UpdatedAt.IsZero())
		assert.WithinDuration(t, time.Now(), project.CreatedAt, 5*time.Second)
		assert.WithinDuration(t, time.Now(), project.UpdatedAt, 5*time.Second)

		stored, err := testPool.GetProjectByID(t.Context(), project.ID)
		require.NoError(t, err)
		assert.Equal(t, project.ID, stored.ID)
		assert.Equal(t, project.Name, stored.Name)
		assert.False(t, stored.CreatedAt.IsZero())
		assert.False(t, stored.UpdatedAt.IsZero())
	})

	t.Run("duplicate ID returns error", func(t *testing.T) {
		project := newTestProject(uniqueProjectID(t))
		t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), project.ID) })
		require.NoError(t, testPool.CreateProject(t.Context(), project))

		err := testPool.CreateProject(t.Context(), newTestProject(project.ID))
		assert.ErrorIs(t, err, new(legacydb.UniqueError))
	})
}

func TestProjectStatements_Update(t *testing.T) {
	t.Run("updates name and refreshes updated_at", func(t *testing.T) {
		project := newTestProject(uniqueProjectID(t))
		project.PreviewOrigins = []string{"*.example.com", "localhost:3000"}
		t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), project.ID) })
		require.NoError(t, testPool.CreateProject(t.Context(), project))
		createdUpdatedAt := project.UpdatedAt
		createdAt := project.CreatedAt

		projectName := "project-" + rand.Text()
		project.Name = projectName
		require.NoError(t, testPool.UpdateProject(t.Context(), project))
		assert.True(t, project.UpdatedAt.After(createdUpdatedAt))
		assert.Equal(t, createdAt.UTC(), project.CreatedAt.UTC())
		assert.Equal(t, []string{"*.example.com", "localhost:3000"}, project.PreviewOrigins)

		stored, err := testPool.GetProjectByID(t.Context(), project.ID)
		require.NoError(t, err)
		assert.Equal(t, projectName, stored.Name)
		assert.Equal(t, project.UpdatedAt.UTC(), stored.UpdatedAt.UTC())
	})

	t.Run("not found returns NoRowFoundError", func(t *testing.T) {
		project := newTestProject(uniqueProjectID(t))
		err := testPool.UpdateProject(t.Context(), project)
		assert.ErrorIs(t, err, new(legacydb.NoRowFoundError))
	})
}

func TestProjectStatements_Get(t *testing.T) {
	t.Run("returns project by ID", func(t *testing.T) {
		project := newTestProject(uniqueProjectID(t))
		t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), project.ID) })
		require.NoError(t, testPool.CreateProject(t.Context(), project))

		stored, err := testPool.GetProjectByID(t.Context(), project.ID)
		require.NoError(t, err)
		assert.Equal(t, project.ID, stored.ID)
		assert.Equal(t, project.Name, stored.Name)
		assert.False(t, stored.CreatedAt.IsZero())
		assert.False(t, stored.UpdatedAt.IsZero())
	})

	t.Run("not found returns NoRowFoundError", func(t *testing.T) {
		_, err := testPool.GetProjectByID(t.Context(), uniqueProjectID(t))
		assert.ErrorIs(t, err, new(legacydb.NoRowFoundError))
	})
}

func TestProjectStatements_Delete(t *testing.T) {
	t.Run("deletes an existing project", func(t *testing.T) {
		project := newTestProject(uniqueProjectID(t))
		t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), project.ID) })
		require.NoError(t, testPool.CreateProject(t.Context(), project))

		require.NoError(t, testPool.DeleteProjectByID(t.Context(), project.ID))

		_, err := testPool.GetProjectByID(t.Context(), project.ID)
		assert.ErrorIs(t, err, new(legacydb.NoRowFoundError))
	})

	t.Run("deleting a missing project is a no-op", func(t *testing.T) {
		assert.NoError(t, testPool.DeleteProjectByID(t.Context(), uniqueProjectID(t)))
	})
}

func TestProjectStatements_List(t *testing.T) {
	projects := make([]*domain.Project, 3)
	for i := range projects {
		if i > 0 {
			time.Sleep(2 * time.Millisecond)
		}
		project := newTestProject(uniqueProjectID(t) + "-" + strconv.Itoa(i))
		t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), project.ID) })
		require.NoError(t, testPool.CreateProject(t.Context(), project))
		projects[i] = project
	}
	ids := projectIDs(projects)

	createdAtCol := database.Col(domain.ProjectFieldCreatedAt)
	list := func(t *testing.T, filter database.Filter[domain.ProjectField], dir database.OrderDirection) []string {
		t.Helper()
		res, err := testPool.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
			Filter: filter,
			Pagination: database.Page[domain.ProjectField]{
				OrderBy: database.OrderBy[domain.ProjectField]{
					Columns:   []database.Column[domain.ProjectField]{createdAtCol},
					Direction: dir,
				},
			},
		})
		require.NoError(t, err)
		return projectIDs(res.Items)
	}

	t.Run("filters by created_at equal", func(t *testing.T) {
		assert.Equal(t, []string{ids[1]}, list(t, database.Equal(createdAtCol, projects[1].CreatedAt), database.OrderAsc))
	})

	t.Run("filters by created_at greater than", func(t *testing.T) {
		assert.Equal(t, []string{ids[2]}, list(t, database.GreaterThan(createdAtCol, projects[1].CreatedAt), database.OrderAsc))
	})

	t.Run("filters by created_at less than", func(t *testing.T) {
		assert.Equal(t, []string{ids[0]}, list(t, database.LessThan(createdAtCol, projects[1].CreatedAt), database.OrderAsc))
	})

	t.Run("sorts by created_at ascending", func(t *testing.T) {
		assert.Equal(t, []string{ids[0], ids[1], ids[2]}, list(t, nil, database.OrderAsc))
	})

	t.Run("sorts by created_at descending", func(t *testing.T) {
		assert.Equal(t, []string{ids[2], ids[1], ids[0]}, list(t, nil, database.OrderDesc))
	})

	t.Run("paginates with a cursor", func(t *testing.T) {
		page := database.Page[domain.ProjectField]{
			Limit: 2,
			OrderBy: database.OrderBy[domain.ProjectField]{
				Columns:   []database.Column[domain.ProjectField]{createdAtCol},
				Direction: database.OrderAsc,
			},
		}

		first, err := testPool.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{Pagination: page})
		require.NoError(t, err)
		assert.Equal(t, []string{ids[0], ids[1]}, projectIDs(first.Items))
		require.NotEmpty(t, first.NextCursor)

		page.Cursor = first.NextCursor
		second, err := testPool.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{Pagination: page})
		require.NoError(t, err)
		assert.Equal(t, []string{ids[2]}, projectIDs(second.Items))
		assert.Empty(t, second.NextCursor)
	})
}
