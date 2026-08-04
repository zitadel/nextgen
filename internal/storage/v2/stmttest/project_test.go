//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"crypto/rand"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestProjectStatements_Create(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("creates project and timestamps are set", func(t *testing.T) {
			project := newTestProject(uniqueProjectID(t))
			t.Cleanup(func() { _ = d.stmts.DeleteProjectByID(context.Background(), project.ID) })

			require.NoError(t, d.stmts.CreateProject(t.Context(), project))
			assert.False(t, project.CreatedAt.IsZero())
			assert.False(t, project.UpdatedAt.IsZero())
			assert.WithinDuration(t, time.Now(), project.CreatedAt, 5*time.Second)
			assert.WithinDuration(t, time.Now(), project.UpdatedAt, 5*time.Second)

			stored, err := d.stmts.GetProjectByID(t.Context(), project.ID)
			require.NoError(t, err)
			assert.Equal(t, project.ID, stored.ID)
			assert.Equal(t, project.Name, stored.Name)
			assert.False(t, stored.CreatedAt.IsZero())
			assert.False(t, stored.UpdatedAt.IsZero())
		})

		t.Run("empty id is assigned by dialect", func(t *testing.T) {
			project := &domain.Project{Name: "project-" + uniqueSuffix(t), PreviewOrigins: []string{}}
			require.NoError(t, d.stmts.CreateProject(t.Context(), project))
			t.Cleanup(func() { _ = d.stmts.DeleteProjectByID(context.Background(), project.ID) })

			require.NotEmpty(t, project.ID)
			assert.True(t, strings.HasPrefix(project.ID, string(domain.PrefixProject)+"_"))

			stored, err := d.stmts.GetProjectByID(t.Context(), project.ID)
			require.NoError(t, err)
			assert.Equal(t, project.ID, stored.ID)
		})

		t.Run("duplicate ID returns error", func(t *testing.T) {
			project := newTestProject(uniqueProjectID(t))
			t.Cleanup(func() { _ = d.stmts.DeleteProjectByID(context.Background(), project.ID) })
			require.NoError(t, d.stmts.CreateProject(t.Context(), project))

			err := d.stmts.CreateProject(t.Context(), newTestProject(project.ID))
			assert.ErrorIs(t, err, new(database.UniqueError))
		})
	})
}

func TestProjectStatements_Update(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("updates name and refreshes updated_at", func(t *testing.T) {
			project := newTestProject(uniqueProjectID(t))
			project.PreviewOrigins = []string{"*.example.com", "localhost:3000"}
			t.Cleanup(func() { _ = d.stmts.DeleteProjectByID(context.Background(), project.ID) })
			require.NoError(t, d.stmts.CreateProject(t.Context(), project))
			createdUpdatedAt := project.UpdatedAt
			createdAt := project.CreatedAt

			projectName := "project-" + rand.Text()
			project.Name = projectName
			require.NoError(t, d.stmts.UpdateProject(t.Context(), project))
			assert.True(t, project.UpdatedAt.After(createdUpdatedAt))
			assert.Equal(t, createdAt.UTC(), project.CreatedAt.UTC())
			assert.Equal(t, []string{"*.example.com", "localhost:3000"}, project.PreviewOrigins)

			stored, err := d.stmts.GetProjectByID(t.Context(), project.ID)
			require.NoError(t, err)
			assert.Equal(t, projectName, stored.Name)
			assert.Equal(t, project.UpdatedAt.UTC(), stored.UpdatedAt.UTC())
		})

		t.Run("not found returns NoRowFoundError", func(t *testing.T) {
			project := newTestProject(uniqueProjectID(t))
			err := d.stmts.UpdateProject(t.Context(), project)
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})
	})
}

func TestProjectStatements_Get(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("returns project by ID", func(t *testing.T) {
			project := newTestProject(uniqueProjectID(t))
			t.Cleanup(func() { _ = d.stmts.DeleteProjectByID(context.Background(), project.ID) })
			require.NoError(t, d.stmts.CreateProject(t.Context(), project))

			stored, err := d.stmts.GetProjectByID(t.Context(), project.ID)
			require.NoError(t, err)
			assert.Equal(t, project.ID, stored.ID)
			assert.Equal(t, project.Name, stored.Name)
			assert.False(t, stored.CreatedAt.IsZero())
			assert.False(t, stored.UpdatedAt.IsZero())
		})

		t.Run("not found returns NoRowFoundError", func(t *testing.T) {
			_, err := d.stmts.GetProjectByID(t.Context(), uniqueProjectID(t))
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})
	})
}

func TestProjectStatements_Delete(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("deletes an existing project", func(t *testing.T) {
			project := newTestProject(uniqueProjectID(t))
			t.Cleanup(func() { _ = d.stmts.DeleteProjectByID(context.Background(), project.ID) })
			require.NoError(t, d.stmts.CreateProject(t.Context(), project))

			require.NoError(t, d.stmts.DeleteProjectByID(t.Context(), project.ID))

			_, err := d.stmts.GetProjectByID(t.Context(), project.ID)
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})

		t.Run("deleting a missing project is a no-op", func(t *testing.T) {
			assert.NoError(t, d.stmts.DeleteProjectByID(t.Context(), uniqueProjectID(t)))
		})
	})
}

func TestProjectStatements_List(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projects := make([]*domain.Project, 3)
		for i := range projects {
			if i > 0 {
				time.Sleep(2 * time.Millisecond)
			}
			project := newTestProject(uniqueProjectID(t) + "-" + strconv.Itoa(i))
			t.Cleanup(func() { _ = d.stmts.DeleteProjectByID(context.Background(), project.ID) })
			require.NoError(t, d.stmts.CreateProject(t.Context(), project))
			projects[i] = project
		}
		ids := projectIDs(projects)

		createdAtCol := database.Col(domain.ProjectFieldCreatedAt)
		idCol := database.Col(domain.ProjectFieldID)
		onlyFixtures := database.Or(
			database.Equal(idCol, ids[0]),
			database.Equal(idCol, ids[1]),
			database.Equal(idCol, ids[2]),
		)

		list := func(t *testing.T, filter database.Filter[domain.ProjectField], dir database.OrderDirection) []string {
			t.Helper()
			res, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
				Filter: database.And(onlyFixtures, filter),
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
			assert.Equal(t, []string{ids[1]}, list(t, database.And(
				database.GreaterThan(createdAtCol, projects[0].CreatedAt),
				database.LessThan(createdAtCol, projects[2].CreatedAt),
			), database.OrderAsc))
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

				first, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{Filter: onlyFixtures, Pagination: page})
				require.NoError(t, err)
				assert.Equal(t, []string{ids[0], ids[1]}, projectIDs(first.Items))
				require.NotEmpty(t, first.NextCursor)

				page.Cursor = first.NextCursor
				second, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{Filter: onlyFixtures, Pagination: page})
				require.NoError(t, err)
				assert.Equal(t, []string{ids[2]}, projectIDs(second.Items))
				assert.Empty(t, second.NextCursor)
			})
		}

		t.Run("paginates under a created_at filter", func(t *testing.T) {
			filter := database.And(onlyFixtures, database.GreaterThan(createdAtCol, projects[0].CreatedAt))
			page := database.Page[domain.ProjectField]{
				Limit: 1,
				OrderBy: database.OrderBy[domain.ProjectField]{
					Columns:   []database.Column[domain.ProjectField]{createdAtCol},
					Direction: database.OrderAsc,
				},
			}

			first, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{Filter: filter, Pagination: page})
			require.NoError(t, err)
			assert.Equal(t, []string{ids[1]}, projectIDs(first.Items))
			require.NotEmpty(t, first.NextCursor)

			page.Cursor = first.NextCursor
			second, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{Filter: filter, Pagination: page})
			require.NoError(t, err)
			assert.Equal(t, []string{ids[2]}, projectIDs(second.Items))

			page.Cursor = second.NextCursor
			third, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{Filter: filter, Pagination: page})
			require.NoError(t, err)
			assert.Empty(t, projectIDs(third.Items))
		})
	})
}

func TestProjectStatements_ListCursorTie(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("ascending", func(t *testing.T) {
			runListCursorTie(t, d, database.OrderAsc, func(ids []string) (first, second []string) {
				return []string{ids[0], ids[1]}, []string{ids[2]}
			})
		})
		t.Run("descending", func(t *testing.T) {
			runListCursorTie(t, d, database.OrderDesc, func(ids []string) (first, second []string) {
				return []string{ids[2], ids[1]}, []string{ids[0]}
			})
		})
	})
}

func runListCursorTie(
	t *testing.T,
	d dialect,
	direction database.OrderDirection,
	wantPages func(ids []string) (first, second []string),
) {
	t.Helper()
	require.NotNil(t, d.seedTiedProjects)

	prefix := uniqueProjectID(t)
	ids := []string{prefix + "-0", prefix + "-1", prefix + "-2"}

	tieCreatedAt := time.Now().UTC().Truncate(time.Microsecond)
	for _, id := range ids {
		t.Cleanup(func() { _ = d.stmts.DeleteProjectByID(context.Background(), id) })
	}
	require.NoError(t, d.seedTiedProjects(t.Context(), ids, tieCreatedAt))

	tieFilter := database.Equal(database.Col(domain.ProjectFieldCreatedAt), tieCreatedAt)
	wantFirst, wantSecond := wantPages(ids)

	page := database.Page[domain.ProjectField]{
		Limit: 2,
		OrderBy: database.OrderBy[domain.ProjectField]{
			Columns: []database.Column[domain.ProjectField]{
				database.Col(domain.ProjectFieldCreatedAt),
				database.Col(domain.ProjectFieldID),
			},
			Direction: direction,
		},
	}

	first, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{Filter: tieFilter, Pagination: page})
	require.NoError(t, err)
	assert.Equal(t, wantFirst, projectIDs(first.Items))
	require.NotEmpty(t, first.NextCursor)

	page.Cursor = first.NextCursor
	second, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{Filter: tieFilter, Pagination: page})
	require.NoError(t, err)
	assert.Equal(t, wantSecond, projectIDs(second.Items))
	assert.Empty(t, second.NextCursor)
}
