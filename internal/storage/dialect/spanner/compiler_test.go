package spanner

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/flowdefinition"
)

const testProjectQuery = "SELECT id, created_at, updated_at, preview_origins FROM projects"

const testFlowDefinitionQuery = "SELECT project_id, id, name FROM flow_definitions"

func TestStatementCompilerReset(t *testing.T) {
	t.Parallel()

	var compiler statementCompiler
	compiler.WriteString("SELECT 1")
	writeArg(&compiler, "x")
	require.NotEmpty(t, compiler.String())
	require.NotEmpty(t, compiler.args)

	compiler.Reset()
	assert.Empty(t, compiler.String())
	assert.Nil(t, compiler.args)
}

func compileFilterOnly[F ~uint8, T any](t *testing.T, filter database.Filter[F], schema database.Schema[F, T]) (string, []any) {
	t.Helper()

	var compiler statementCompiler
	compileFilter(&compiler, filter, schema)
	return compiler.String(), compiler.args
}

func compileOrderByOnly[F ~uint8, T any](t *testing.T, orderBy database.OrderBy[F], schema database.Schema[F, T]) (string, []any) {
	t.Helper()

	var compiler statementCompiler
	compileOrderBy(&compiler, orderBy, schema)
	return compiler.String(), compiler.args
}

func compileLimitOnly(t *testing.T, limit uint32) (string, []any) {
	t.Helper()

	var compiler statementCompiler
	compileLimit(&compiler, limit)
	return compiler.String(), compiler.args
}

func compileReadExpectError[F ~uint8, T any](t *testing.T, stmt string, opts *database.ListOptions[F], schema database.Schema[F, T]) error {
	t.Helper()

	var compiler statementCompiler
	return compileRead(&compiler, stmt, opts, schema)
}

func assertDatabaseErrorCode(t *testing.T, err error, code string) {
	t.Helper()

	require.Error(t, err)
	var dbErr database.Error
	require.ErrorAs(t, err, &dbErr)
	assert.Equal(t, code, dbErr.Code)
}

func TestCompileReadNoFilterNoOrderNoLimit(t *testing.T) {
	t.Parallel()

	sql, args := compileProjectRead(t, &database.ListOptions[domain.ProjectField]{})
	assert.Equal(t, testProjectQuery, sql)
	assert.Empty(t, args)
}

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

	wantSQL := testProjectQuery + " WHERE id = @p1 ORDER BY created_at, id LIMIT @p2"
	assert.Equal(t, wantSQL, sql)
	require.Len(t, args, 2)
	assert.Equal(t, "proj_1", args[0])
	assert.Equal(t, int64(10), args[1])
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

	assert.Contains(t, sql, "((created_at > @p1) OR (created_at = @p2 AND id > @p3))")
	require.Len(t, args, 3)
	assert.Equal(t, createdAt, args[0])
	assert.Equal(t, createdAt, args[1])
	assert.Equal(t, "proj_1", args[2])
}

func TestCompileReadStringContains(t *testing.T) {
	t.Parallel()

	sql, args := compileFlowDefinitionRead(t, &database.ListOptions[domain.FlowDefinitionField]{
		Filter: database.StringContains(database.Col(domain.FlowDefinitionFieldName), "login"),
	})

	assert.Contains(t, sql, "WHERE name LIKE '%' || @p1 || '%'")
	require.Len(t, args, 1)
	assert.Equal(t, "login", args[0])
}

func TestCompileReadStringEqualFold(t *testing.T) {
	t.Parallel()

	sql, args := compileFlowDefinitionRead(t, &database.ListOptions[domain.FlowDefinitionField]{
		Filter: database.StringEqualFold(database.Col(domain.FlowDefinitionFieldName), "Login"),
	})

	assert.Contains(t, sql, "WHERE LOWER(name) = LOWER(@p1)")
	require.Len(t, args, 1)
	assert.Equal(t, "Login", args[0])
}

func TestCompileArrayContains(t *testing.T) {
	t.Parallel()

	sql, args := compileFilterOnly(t,
		database.ArrayContains(database.Col(domain.FlowDefinitionFieldPurposes), "login"),
		flowdefinition.Schema,
	)
	assert.Equal(t, "@p1 IN UNNEST(purposes)", sql)
	require.Len(t, args, 1)
	assert.Equal(t, "login", args[0])
}

func TestCompileStatusEqualNoParamCast(t *testing.T) {
	t.Parallel()

	sql, args := compileFilterOnly(t,
		database.Equal(database.Col(domain.FlowDefinitionFieldStatus), "active"),
		flowdefinition.Schema,
	)
	assert.Equal(t, "status = @p1", sql)
	require.Len(t, args, 1)
	assert.Equal(t, "active", args[0])
}

func TestCompileFilterNil(t *testing.T) {
	t.Parallel()

	sql, args := compileFilterOnly[domain.ProjectField](t, nil, projectSchema)
	assert.Empty(t, sql)
	assert.Empty(t, args)
}

func TestCompileAndFilter(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		filter  database.Filter[domain.ProjectField]
		wantSQL string
		wantLen int
	}{
		{
			name:    "empty",
			filter:  database.AndFilter[domain.ProjectField]{},
			wantSQL: "",
			wantLen: 0,
		},
		{
			name:    "single child",
			filter:  database.And(database.Equal(database.Col(domain.ProjectFieldID), "proj_1")),
			wantSQL: "id = @p1",
			wantLen: 1,
		},
		{
			name: "two children",
			filter: database.And(
				database.Equal(database.Col(domain.ProjectFieldID), "proj_1"),
				database.Equal(database.Col(domain.ProjectFieldCreatedAt), "now"),
			),
			wantSQL: "(id = @p1 AND created_at = @p2)",
			wantLen: 2,
		},
		{
			name: "three children",
			filter: database.And(
				database.Equal(database.Col(domain.ProjectFieldID), "proj_1"),
				database.Equal(database.Col(domain.ProjectFieldCreatedAt), "t1"),
				database.Equal(database.Col(domain.ProjectFieldUpdatedAt), "t2"),
			),
			wantSQL: "(id = @p1 AND created_at = @p2 AND updated_at = @p3)",
			wantLen: 3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			sql, args := compileFilterOnly(t, tt.filter, projectSchema)
			assert.Equal(t, tt.wantSQL, sql)
			require.Len(t, args, tt.wantLen)
		})
	}
}

func TestCompileOrFilter(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		filter  database.Filter[domain.ProjectField]
		wantSQL string
		wantLen int
	}{
		{
			name:    "empty",
			filter:  database.OrFilter[domain.ProjectField]{},
			wantSQL: "",
			wantLen: 0,
		},
		{
			name:    "single child",
			filter:  database.Or(database.Equal(database.Col(domain.ProjectFieldID), "proj_1")),
			wantSQL: "id = @p1",
			wantLen: 1,
		},
		{
			name: "two children",
			filter: database.Or(
				database.Equal(database.Col(domain.ProjectFieldID), "proj_1"),
				database.Equal(database.Col(domain.ProjectFieldCreatedAt), "now"),
			),
			wantSQL: "(id = @p1 OR created_at = @p2)",
			wantLen: 2,
		},
		{
			name: "three children",
			filter: database.Or(
				database.Equal(database.Col(domain.ProjectFieldID), "proj_1"),
				database.Equal(database.Col(domain.ProjectFieldCreatedAt), "t1"),
				database.Equal(database.Col(domain.ProjectFieldUpdatedAt), "t2"),
			),
			wantSQL: "(id = @p1 OR created_at = @p2 OR updated_at = @p3)",
			wantLen: 3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			sql, args := compileFilterOnly(t, tt.filter, projectSchema)
			assert.Equal(t, tt.wantSQL, sql)
			require.Len(t, args, tt.wantLen)
		})
	}
}

func TestCompileFilterNestedAndOr(t *testing.T) {
	t.Parallel()

	filter := database.And(
		database.Equal(database.Col(domain.ProjectFieldID), "proj_1"),
		database.Or(
			database.Equal(database.Col(domain.ProjectFieldCreatedAt), "t1"),
			database.Equal(database.Col(domain.ProjectFieldUpdatedAt), "t2"),
		),
	)

	sql, args := compileFilterOnly(t, filter, projectSchema)
	assert.Equal(t, "(id = @p1 AND (created_at = @p2 OR updated_at = @p3))", sql)
	require.Len(t, args, 3)
}

func TestCompileCompareFilterSingleColumn(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, 6, 26, 10, 0, 0, 0, time.UTC)
	tests := []struct {
		name    string
		filter  database.Filter[domain.ProjectField]
		wantSQL string
		wantArg any
	}{
		{
			name:    "equal",
			filter:  database.Equal(database.Col(domain.ProjectFieldID), "proj_1"),
			wantSQL: "id = @p1",
			wantArg: "proj_1",
		},
		{
			name:    "greater than",
			filter:  database.GreaterThan(database.Col(domain.ProjectFieldCreatedAt), createdAt),
			wantSQL: "created_at > @p1",
			wantArg: createdAt,
		},
		{
			name:    "less than",
			filter:  database.LessThan(database.Col(domain.ProjectFieldCreatedAt), createdAt),
			wantSQL: "created_at < @p1",
			wantArg: createdAt,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			sql, args := compileFilterOnly(t, tt.filter, projectSchema)
			assert.Equal(t, tt.wantSQL, sql)
			require.Len(t, args, 1)
			assert.Equal(t, tt.wantArg, args[0])
		})
	}
}

func TestCompileCompareFilterBoolEqual(t *testing.T) {
	t.Parallel()

	hasFactors := database.Col(domain.SessionFieldHasVerifiedFactors)
	existsSQL := sessionSchema.MustSQLName(domain.SessionFieldHasVerifiedFactors)

	sql, args := compileFilterOnly(t, database.Equal(hasFactors, true), sessionSchema)
	assert.Equal(t, existsSQL, sql)
	assert.Empty(t, args)

	sql, args = compileFilterOnly(t, database.Equal(hasFactors, false), sessionSchema)
	assert.Equal(t, "NOT "+existsSQL, sql)
	assert.Empty(t, args)
}

func TestCompileCompareFilterTuple(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, 6, 26, 10, 0, 0, 0, time.UTC)
	tests := []struct {
		name     string
		filter   database.Filter[domain.ProjectField]
		wantSQL  string
		wantArgs []any
	}{
		{
			name: "compare less tuple",
			filter: database.CompareLess(
				database.Term(database.Col(domain.ProjectFieldCreatedAt), createdAt),
				database.Term(database.Col(domain.ProjectFieldID), "proj_1"),
			),
			wantSQL:  "((created_at < @p1) OR (created_at = @p2 AND id < @p3))",
			wantArgs: []any{createdAt, createdAt, "proj_1"},
		},
		{
			name: "compare equal tuple",
			filter: database.CompareEqual(
				database.Term(database.Col(domain.ProjectFieldCreatedAt), createdAt),
				database.Term(database.Col(domain.ProjectFieldID), "proj_1"),
			),
			wantSQL:  "(created_at = @p1 AND id = @p2)",
			wantArgs: []any{createdAt, "proj_1"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			sql, args := compileFilterOnly(t, tt.filter, projectSchema)
			assert.Equal(t, tt.wantSQL, sql)
			assert.Equal(t, tt.wantArgs, args)
		})
	}
}

func TestCompileStringFilter(t *testing.T) {
	t.Parallel()

	col := database.Col(domain.FlowDefinitionFieldName)
	tests := []struct {
		name    string
		filter  *database.StringFilter[domain.FlowDefinitionField]
		wantSQL string
		wantArg any
	}{
		{
			name:    "equal",
			filter:  database.StringEqual(col, "login"),
			wantSQL: "name = @p1",
			wantArg: "login",
		},
		{
			name:    "starts with",
			filter:  database.StringStartsWith(col, "acme"),
			wantSQL: "name LIKE @p1 || '%'",
			wantArg: "acme",
		},
		{
			name:    "contains",
			filter:  database.StringContains(col, "login"),
			wantSQL: "name LIKE '%' || @p1 || '%'",
			wantArg: "login",
		},
		{
			name:    "ends with",
			filter:  database.StringEndsWith(col, "suffix"),
			wantSQL: "name LIKE '%' || @p1",
			wantArg: "suffix",
		},
		{
			name:    "equal fold",
			filter:  database.StringEqualFold(col, "Login"),
			wantSQL: "LOWER(name) = LOWER(@p1)",
			wantArg: "Login",
		},
		{
			name:    "starts with fold",
			filter:  database.StringStartsWithFold(col, "Acme"),
			wantSQL: "LOWER(name) LIKE @p1 || '%'",
			wantArg: "acme",
		},
		{
			name:    "contains fold",
			filter:  database.StringContainsFold(col, "Flow"),
			wantSQL: "LOWER(name) LIKE '%' || @p1 || '%'",
			wantArg: "flow",
		},
		{
			name:    "ends with fold",
			filter:  database.StringEndsWithFold(col, "Suffix"),
			wantSQL: "LOWER(name) LIKE '%' || @p1",
			wantArg: "suffix",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			sql, args := compileFilterOnly(t, tt.filter, flowdefinition.Schema)
			assert.Equal(t, tt.wantSQL, sql)
			require.Len(t, args, 1)
			assert.Equal(t, tt.wantArg, args[0])
		})
	}
}

func TestCompileOrderBy(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		orderBy database.OrderBy[domain.ProjectField]
		wantSQL string
	}{
		{
			name:    "empty columns",
			orderBy: database.OrderBy[domain.ProjectField]{},
			wantSQL: "",
		},
		{
			name: "single asc",
			orderBy: database.OrderBy[domain.ProjectField]{
				Columns: []database.Column[domain.ProjectField]{
					database.Col(domain.ProjectFieldCreatedAt),
				},
				Direction: database.OrderAsc,
			},
			wantSQL: " ORDER BY created_at",
		},
		{
			name: "multi asc",
			orderBy: database.OrderBy[domain.ProjectField]{
				Columns: []database.Column[domain.ProjectField]{
					database.Col(domain.ProjectFieldCreatedAt),
					database.Col(domain.ProjectFieldID),
				},
				Direction: database.OrderAsc,
			},
			wantSQL: " ORDER BY created_at, id",
		},
		{
			name: "desc",
			orderBy: database.OrderBy[domain.ProjectField]{
				Columns: []database.Column[domain.ProjectField]{
					database.Col(domain.ProjectFieldCreatedAt),
					database.Col(domain.ProjectFieldID),
				},
				Direction: database.OrderDesc,
			},
			wantSQL: " ORDER BY created_at DESC, id DESC",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			sql, args := compileOrderByOnly(t, tt.orderBy, projectSchema)
			assert.Equal(t, tt.wantSQL, sql)
			assert.Empty(t, args)
		})
	}
}

func TestCompileLimit(t *testing.T) {
	t.Parallel()

	t.Run("zero", func(t *testing.T) {
		t.Parallel()

		sql, args := compileLimitOnly(t, 0)
		assert.Empty(t, sql)
		assert.Empty(t, args)
	})

	t.Run("non zero", func(t *testing.T) {
		t.Parallel()

		sql, args := compileLimitOnly(t, 25)
		assert.Equal(t, " LIMIT @p1", sql)
		require.Len(t, args, 1)
		assert.Equal(t, int64(25), args[0])
	})
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
	err := compileRead(&compiler, testFlowDefinitionQuery, opts, flowdefinition.Schema)
	require.NoError(t, err)
	return compiler.String(), compiler.args
}

// TestCompileOrderByNullable pins that spanner emits no NULLS clause: the
// engine rejects it, and its fixed NULL ordering already matches what the
// other dialects state explicitly.
func TestCompileOrderByNullable(t *testing.T) {
	t.Parallel()

	columns := []database.Column[domain.SessionField]{
		database.Col(domain.SessionFieldUserID),
		database.Col(domain.SessionFieldID),
	}
	tests := []struct {
		name      string
		direction database.OrderDirection
		wantSQL   string
	}{
		{
			name:      "asc",
			direction: database.OrderAsc,
			wantSQL:   " ORDER BY s.user_id, s.id",
		},
		{
			name:      "desc",
			direction: database.OrderDesc,
			wantSQL:   " ORDER BY s.user_id DESC, s.id DESC",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			sql, args := compileOrderByOnly(t, database.OrderBy[domain.SessionField]{
				Columns:   columns,
				Direction: tt.direction,
			}, sessionSchema)
			assert.Equal(t, tt.wantSQL, sql)
			assert.Empty(t, args)
		})
	}
}

func TestCompileCompareFilterNullableKeyset(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		filter   database.Filter[domain.SessionField]
		wantSQL  string
		wantArgs []any
	}{
		{
			name: "keyset greater expands null aware",
			filter: database.CompareGreater(
				database.Term(database.Col(domain.SessionFieldUserID), "usr_1"),
				database.Term(database.Col(domain.SessionFieldID), "sess_1"),
			),
			wantSQL:  "((s.user_id > @p1) OR (s.user_id = @p2 AND s.id > @p3))",
			wantArgs: []any{"usr_1", "usr_1", "sess_1"},
		},
		{
			name: "keyset less admits null rows",
			filter: database.CompareLess(
				database.Term(database.Col(domain.SessionFieldUserID), "usr_1"),
				database.Term(database.Col(domain.SessionFieldID), "sess_1"),
			),
			wantSQL:  "(((s.user_id < @p1 OR s.user_id IS NULL)) OR (s.user_id = @p2 AND (s.id < @p3 OR s.id IS NULL)))",
			wantArgs: []any{"usr_1", "usr_1", "sess_1"},
		},
		{
			name:     "range filter keeps plain compare",
			filter:   database.LessThan(database.Col(domain.SessionFieldUserID), "usr_1"),
			wantSQL:  "s.user_id < @p1",
			wantArgs: []any{"usr_1"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			sql, args := compileFilterOnly(t, tt.filter, sessionSchema)
			assert.Equal(t, tt.wantSQL, sql)
			assert.Equal(t, tt.wantArgs, args)
		})
	}
}

func TestCompileCompareFilterNilLeadingValue(t *testing.T) {
	t.Parallel()

	sql, args := compileFilterOnly(t, database.CompareGreater(
		database.Term(database.Col(domain.SessionFieldUserID), nil),
		database.Term(database.Col(domain.SessionFieldID), "sess_1"),
	), sessionSchema)
	assert.Equal(t,
		"((s.user_id IS NOT NULL) OR (s.user_id IS NULL AND s.id > @p1))",
		sql,
	)
	require.Len(t, args, 1)
	assert.Equal(t, "sess_1", args[0])
}
