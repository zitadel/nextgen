package postgres

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

const testProjectQuery = "SELECT id, created_at, updated_at, project_secret, preview_secret, preview_origins FROM zitadel_nextgen.projects"

func TestCompileReadFilterAndOrderBy(t *testing.T) {
	t.Parallel()

	sql, args := compileProjectRead(t, &database.ListOptions[domain.ProjectField]{
		Filter: database.Equal(database.Col(domain.ProjectFieldID), "proj_1"),
		Pagination: database.Page[domain.ProjectField]{
			Limit: 10,
			OrderBy: database.OrderBy[domain.ProjectField]{
				Columns: []database.Column[domain.ProjectField]{
					database.Col(domain.ProjectFieldCreatedAt),
					database.Col(domain.ProjectFieldID),
				},
				Direction: database.OrderAsc,
			},
		},
	})

	wantSQL := testProjectQuery + " WHERE id = $1 ORDER BY created_at, id LIMIT $2"
	assert.Equal(t, wantSQL, sql)
	require.Len(t, args, 2)
	assert.Equal(t, "proj_1", args[0])
	assert.Equal(t, uint32(10), args[1])
}

func TestCompileReadKeysetCursorAsc(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, 6, 26, 10, 0, 0, 0, time.UTC)
	cursor := (&pagination.Cursor[domain.ProjectField]{
		Columns: []database.Column[domain.ProjectField]{
			database.Col(domain.ProjectFieldCreatedAt),
			database.Col(domain.ProjectFieldID),
		},
		Values: []any{createdAt, "proj_1"},
	}).Marshal()

	sql, args := compileProjectRead(t, &database.ListOptions[domain.ProjectField]{
		Pagination: database.Page[domain.ProjectField]{
			Limit: 5,
			OrderBy: database.OrderBy[domain.ProjectField]{
				Columns: []database.Column[domain.ProjectField]{
					database.Col(domain.ProjectFieldCreatedAt),
					database.Col(domain.ProjectFieldID),
				},
				Direction: database.OrderAsc,
			},
			Cursor: cursor,
		},
	})

	assert.Contains(t, sql, "(created_at, id) > ($1, $2)")
	require.Len(t, args, 3)
	assert.Equal(t, createdAt.UTC().Format(time.RFC3339), args[0])
	assert.Equal(t, "proj_1", args[1])
	assert.Equal(t, uint32(5), args[2])
}

func compileProjectRead(t *testing.T, opts *database.ListOptions[domain.ProjectField]) (string, []any) {
	t.Helper()

	var compiler statementCompiler
	err := compileRead(&compiler, testProjectQuery, opts, projectSchema)
	require.NoError(t, err)
	return compiler.String(), compiler.args
}
