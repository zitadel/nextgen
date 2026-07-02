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

const testFlowDefinitionQuery = "SELECT project_id, id, name FROM zitadel_nextgen.flow_definitions"

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

func TestCompileReadCompareGreater(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, 6, 26, 10, 0, 0, 0, time.UTC)
	sql, args := compileProjectRead(t, &database.ListOptions[domain.ProjectField]{
		Filter: database.CompareGreater(
			database.Term(database.Col(domain.ProjectFieldCreatedAt), createdAt),
			database.Term(database.Col(domain.ProjectFieldID), "proj_1"),
		),
	})

	assert.Contains(t, sql, "(created_at, id) > ($1, $2)")
	require.Len(t, args, 2)
	assert.Equal(t, createdAt, args[0])
	assert.Equal(t, "proj_1", args[1])
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
	assert.Equal(t, createdAt, args[0])
	assert.Equal(t, "proj_1", args[1])
	assert.Equal(t, uint32(5), args[2])
}

func TestCompileReadStringContains(t *testing.T) {
	t.Parallel()

	sql, args := compileFlowDefinitionRead(t, &database.ListOptions[domain.FlowDefinitionField]{
		Filter: database.StringContains(database.Col(domain.FlowDefinitionFieldName), "login"),
	})

	assert.Contains(t, sql, "WHERE name LIKE '%' || $1 || '%'")
	require.Len(t, args, 1)
	assert.Equal(t, "login", args[0])
}

func TestCompileReadCursorDoesNotMutateCallerFilter(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, 6, 26, 10, 0, 0, 0, time.UTC)
	baseFilter := database.Equal(database.Col(domain.ProjectFieldID), "proj_1")
	cursor := (&pagination.Cursor[domain.ProjectField]{
		Columns: []database.Column[domain.ProjectField]{
			database.Col(domain.ProjectFieldCreatedAt),
			database.Col(domain.ProjectFieldID),
		},
		Values: []any{createdAt, "proj_1"},
	}).Marshal()

	opts := &database.ListOptions[domain.ProjectField]{
		Filter: baseFilter,
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
	}

	sql1, args1 := compileProjectRead(t, opts)
	assert.Equal(t, baseFilter, opts.Filter)

	sql2, args2 := compileProjectRead(t, opts)
	assert.Equal(t, baseFilter, opts.Filter)
	assert.Equal(t, sql1, sql2)
	assert.Equal(t, args1, args2)
}

func TestCompileReadStringEqualFold(t *testing.T) {
	t.Parallel()

	sql, args := compileFlowDefinitionRead(t, &database.ListOptions[domain.FlowDefinitionField]{
		Filter: database.StringEqualFold(database.Col(domain.FlowDefinitionFieldName), "Login"),
	})

	assert.Contains(t, sql, "WHERE LOWER(name) = LOWER($1)")
	require.Len(t, args, 1)
	assert.Equal(t, "Login", args[0])
}

func compileProjectRead(t *testing.T, opts *database.ListOptions[domain.ProjectField]) (string, []any) {
	t.Helper()

	var compiler statementCompiler
	err := compileRead(&compiler, testProjectQuery, opts, projectSchema)
	require.NoError(t, err)
	return compiler.String(), compiler.args
}

func compileFlowDefinitionRead(t *testing.T, opts *database.ListOptions[domain.FlowDefinitionField]) (string, []any) {
	t.Helper()

	var compiler statementCompiler
	err := compileRead(&compiler, testFlowDefinitionQuery, opts, flowDefinitionSchema)
	require.NoError(t, err)
	return compiler.String(), compiler.args
}
