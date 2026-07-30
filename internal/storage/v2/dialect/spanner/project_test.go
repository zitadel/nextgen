//go:build spanner_integration

package spanner

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// A tie is what the lexicographic cursor expansion exists for: when created_at
// matches, only the id tiebreaker can decide, so the page boundary falls
// between two rows that compare equal on the leading column.
//
// Seeding uses dialect-specific DML (CreateProject leaves created_at to the
// column default), so this case stays in the dialect package. Portable project
// statement coverage lives in stmttest.
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
