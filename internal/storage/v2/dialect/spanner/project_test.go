//go:build spanner_integration

package spanner

import (
	"context"
	"crypto/rand"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
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
		project.PreviewOrigins = []string{"*.example.com", "localhost:3000"}
		t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), project.ID) })
		require.NoError(t, stmts.CreateProject(t.Context(), project))
		createdUpdatedAt := project.UpdatedAt
		createdAt := project.CreatedAt

		projectName := "project-" + rand.Text()
		project.Name = projectName
		require.NoError(t, stmts.UpdateProject(t.Context(), project))
		assert.True(t, project.UpdatedAt.After(createdUpdatedAt))
		assert.Equal(t, createdAt.UTC(), project.CreatedAt.UTC())
		assert.Equal(t, []string{"*.example.com", "localhost:3000"}, project.PreviewOrigins)

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

	projects := make([]*domain.Project, 3)
	for i := range projects {
		if i > 0 {
			time.Sleep(2 * time.Millisecond)
		}
		project := newTestProject(uniqueProjectID(t) + "-" + strconv.Itoa(i))
		t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), project.ID) })
		require.NoError(t, stmts.CreateProject(t.Context(), project))
		projects[i] = project
	}
	ids := projectIDs(projects)

	createdAtCol := database.Col(domain.ProjectFieldCreatedAt)
	// The table is shared with the rest of the package. Naming the fixtures keeps
	// foreign rows out of the assertions without constraining the column under test.
	idCol := v2database.Col(domain.ProjectFieldID)
	onlyFixtures := v2database.Or(
		v2database.Equal(idCol, ids[0]),
		v2database.Equal(idCol, ids[1]),
		v2database.Equal(idCol, ids[2]),
	)

	list := func(t *testing.T, filter database.Filter[domain.ProjectField], dir database.OrderDirection) []string {
		t.Helper()
		res, err := stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
			Filter: v2database.And(onlyFixtures, filter),
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

	t.Run("filters by a created_at range", func(t *testing.T) {
		assert.Equal(t, []string{ids[1]}, list(t, v2database.And(
			v2database.GreaterThan(createdAtCol, projects[0].CreatedAt),
			v2database.LessThan(createdAtCol, projects[2].CreatedAt),
		), v2database.OrderAsc))
	})

	t.Run("sorts by created_at ascending", func(t *testing.T) {
		assert.Equal(t, []string{ids[0], ids[1], ids[2]}, list(t, nil, database.OrderAsc))
	})

	t.Run("sorts by created_at descending", func(t *testing.T) {
		assert.Equal(t, []string{ids[2], ids[1], ids[0]}, list(t, nil, database.OrderDesc))
	})

	cursorTests := []struct {
		name    string
		columns []database.Column[domain.ProjectField]
	}{
		{"paginates with a cursor", []database.Column[domain.ProjectField]{createdAtCol}},
		// Callers append id as a tiebreaker, so every cursor a list endpoint
		// issues spans two columns.
		{"paginates with a tiebreaker column", []database.Column[domain.ProjectField]{createdAtCol, database.Col(domain.ProjectFieldID)}},
	}

	for _, tc := range cursorTests {
		t.Run(tc.name, func(t *testing.T) {
			page := database.Page[domain.ProjectField]{
				Limit: 2,
				OrderBy: database.OrderBy[domain.ProjectField]{
					Columns:   tc.columns,
					Direction: database.OrderAsc,
				},
			}

			first, err := stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{Filter: onlyFixtures, Pagination: page})
			require.NoError(t, err)
			assert.Equal(t, []string{ids[0], ids[1]}, projectIDs(first.Items))
			require.NotEmpty(t, first.NextCursor)

			page.Cursor = first.NextCursor
			second, err := stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{Filter: onlyFixtures, Pagination: page})
			require.NoError(t, err)
			assert.Equal(t, []string{ids[2]}, projectIDs(second.Items))
			assert.Empty(t, second.NextCursor)
		})
	}

	// The cursor terms and the caller's filter both target created_at, so the
	// keyset has to compose with a predicate on its own sort column.
	t.Run("paginates under a created_at filter", func(t *testing.T) {
		filter := v2database.And(onlyFixtures, v2database.GreaterThan(createdAtCol, projects[0].CreatedAt))
		page := v2database.Page[domain.ProjectField]{
			Limit: 1,
			OrderBy: v2database.OrderBy[domain.ProjectField]{
				Columns:   []v2database.Column[domain.ProjectField]{createdAtCol},
				Direction: v2database.OrderAsc,
			},
		}

		first, err := stmts.ListProjects(t.Context(), &v2database.ListOptions[domain.ProjectField]{Filter: filter, Pagination: page})
		require.NoError(t, err)
		assert.Equal(t, []string{ids[1]}, projectIDs(first.Items))
		require.NotEmpty(t, first.NextCursor)

		// A full page always carries a cursor, so the last page is identified by
		// its contents rather than by an empty NextCursor.
		page.Cursor = first.NextCursor
		second, err := stmts.ListProjects(t.Context(), &v2database.ListOptions[domain.ProjectField]{Filter: filter, Pagination: page})
		require.NoError(t, err)
		assert.Equal(t, []string{ids[2]}, projectIDs(second.Items))

		page.Cursor = second.NextCursor
		third, err := stmts.ListProjects(t.Context(), &v2database.ListOptions[domain.ProjectField]{Filter: filter, Pagination: page})
		require.NoError(t, err)
		assert.Empty(t, projectIDs(third.Items))
	})
}

// A tie is what the lexicographic cursor expansion exists for: when created_at
// matches, only the id tiebreaker can decide, so the page boundary falls
// between two rows that compare equal on the leading column.
func TestProjectStatements_ListCursorTie(t *testing.T) {
	ctx := t.Context()
	stmts := testClient.Statements()

	// One prefix with an ordered suffix, so the ids sort in creation order.
	prefix := uniqueProjectID(t)
	ids := []string{prefix + "-0", prefix + "-1", prefix + "-2"}

	// CreateProject leaves created_at to the column default, so the rows are
	// seeded by DML to share one timestamp. Microseconds round-trip in both
	// dialects, which keeps the stored value equal to the filter value below.
	tieCreatedAt := time.Now().UTC().Truncate(time.Microsecond)
	db := newClientDB(testClient.client)
	for _, id := range ids {
		t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), id) })
		_, err := db.Update(ctx, buildStatement(
			`INSERT INTO projects (id, name, created_at, updated_at) VALUES (@p1, @p2, @p3, @p3)`,
			id, "project-"+id, tieCreatedAt,
		).statement())
		require.NoError(t, err)
	}

	// Selects only this test's rows.
	tieFilter := database.Equal(database.Col(domain.ProjectFieldCreatedAt), tieCreatedAt)

	tests := []struct {
		name      string
		direction database.OrderDirection
		first     []string
		second    []string
	}{
		{"ascending", database.OrderAsc, []string{ids[0], ids[1]}, []string{ids[2]}},
		{"descending", database.OrderDesc, []string{ids[2], ids[1]}, []string{ids[0]}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			page := database.Page[domain.ProjectField]{
				Limit: 2,
				OrderBy: database.OrderBy[domain.ProjectField]{
					Columns: []database.Column[domain.ProjectField]{
						database.Col(domain.ProjectFieldCreatedAt),
						database.Col(domain.ProjectFieldID),
					},
					Direction: tt.direction,
				},
			}

			first, err := stmts.ListProjects(ctx, &database.ListOptions[domain.ProjectField]{Filter: tieFilter, Pagination: page})
			require.NoError(t, err)
			assert.Equal(t, tt.first, projectIDs(first.Items))
			require.NotEmpty(t, first.NextCursor)

			page.Cursor = first.NextCursor
			second, err := stmts.ListProjects(ctx, &database.ListOptions[domain.ProjectField]{Filter: tieFilter, Pagination: page})
			require.NoError(t, err)
			assert.Equal(t, tt.second, projectIDs(second.Items))
			assert.Empty(t, second.NextCursor)
		})
	}
}
