//go:build spanner_integration

package spanner

import (
	"context"
	"crypto/rand"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

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
