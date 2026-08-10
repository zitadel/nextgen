package sqlite

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

const testProjectQuery = "SELECT id, name, preview_origins, created_at, updated_at FROM projects"

func compileProjectRead(t *testing.T, opts *database.ListOptions[domain.ProjectField]) (string, []any) {
	t.Helper()
	var compiler statementCompiler
	require.NoError(t, compileRead(&compiler, testProjectQuery, opts, projectSchema))
	return compiler.String(), compiler.args
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
			},
		},
	})

	assert.Equal(t, testProjectQuery+" WHERE id = ? ORDER BY created_at, id LIMIT ?", sql)
	require.Len(t, args, 2)
	assert.Equal(t, "proj_1", args[0])
	assert.Equal(t, int64(10), args[1])
}

func TestWriteArgCoercesTimeAndDuration(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, 6, 26, 10, 0, 0, 0, time.UTC)
	ttl := 10 * time.Minute
	var c statementCompiler
	writeArg(&c, createdAt)
	c.WriteString(", ")
	writeArg(&c, ttl)

	assert.Equal(t, "?, ?", c.String())
	require.Len(t, c.args, 2)
	assert.Equal(t, createdAt.UnixNano(), c.args[0])
	assert.Equal(t, ttl.Nanoseconds(), c.args[1])
}

func TestCompileArrayContainsUsesJSONEach(t *testing.T) {
	t.Parallel()

	sql, args := compileProjectRead(t, &database.ListOptions[domain.ProjectField]{
		Filter: database.ArrayContains(database.Col(domain.ProjectFieldPreviewOrigins), "https://app.example"),
	})

	assert.Equal(t,
		testProjectQuery+` WHERE EXISTS (SELECT 1 FROM json_each(preview_origins) WHERE value = ?)`,
		sql,
	)
	require.Len(t, args, 1)
	assert.Equal(t, "https://app.example", args[0])
}

func TestCompileStringFilterIgnoreCase(t *testing.T) {
	t.Parallel()

	var c statementCompiler
	compileFilter(&c, database.StringEqualFold(database.Col(domain.ProjectFieldName), "Acme"), projectSchema)
	assert.Equal(t, "LOWER(name) = LOWER(?)", c.String())
	require.Len(t, c.args, 1)
	assert.Equal(t, "Acme", c.args[0])
}

func TestCompileStringFilterContainsFoldUsesSQLLower(t *testing.T) {
	t.Parallel()

	var c statementCompiler
	compileFilter(&c, database.StringContainsFold(database.Col(domain.ProjectFieldName), "Übung"), projectSchema)
	assert.Equal(t, `LOWER(name) LIKE LOWER('%' || ? || '%') ESCAPE '\'`, c.String())
	require.Len(t, c.args, 1)
	assert.Equal(t, "Übung", c.args[0])
}

func TestCompileCompareFilterNilLeadingValue(t *testing.T) {
	t.Parallel()

	var c statementCompiler
	compileFilter(&c, database.CompareGreater(
		database.Term(database.Col(domain.TokenFieldExpiresAt), nil),
		database.Term(database.Col(domain.TokenFieldTokenID), "10"),
	), tokenSchema)
	assert.Equal(t,
		"((expires_at IS NOT NULL) OR (expires_at IS NULL AND token_id > ?))",
		c.String(),
	)
	require.Len(t, c.args, 1)
	assert.Equal(t, "10", c.args[0])
}

func TestCompileStringFilterLikeUsesEscape(t *testing.T) {
	t.Parallel()

	var c statementCompiler
	compileFilter(&c, database.StringContains(database.Col(domain.ProjectFieldName), `100%_a\b`), projectSchema)
	assert.Equal(t, `name LIKE '%' || ? || '%' ESCAPE '\'`, c.String())
	require.Len(t, c.args, 1)
	assert.Equal(t, `100\%\_a\\b`, c.args[0])
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

			var c statementCompiler
			compileOrderBy(&c, tt.orderBy, projectSchema)
			assert.Equal(t, tt.wantSQL, c.String())
			assert.Empty(t, c.args)
		})
	}
}

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
			wantSQL:   " ORDER BY s.user_id NULLS FIRST, s.id",
		},
		{
			name:      "desc",
			direction: database.OrderDesc,
			wantSQL:   " ORDER BY s.user_id DESC NULLS LAST, s.id DESC",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var c statementCompiler
			compileOrderBy(&c, database.OrderBy[domain.SessionField]{
				Columns:   columns,
				Direction: tt.direction,
			}, sessionSchema)
			assert.Equal(t, tt.wantSQL, c.String())
			assert.Empty(t, c.args)
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
			wantSQL:  "((s.user_id > ?) OR (s.user_id = ? AND s.id > ?))",
			wantArgs: []any{"usr_1", "usr_1", "sess_1"},
		},
		{
			name: "keyset less admits null rows",
			filter: database.CompareLess(
				database.Term(database.Col(domain.SessionFieldUserID), "usr_1"),
				database.Term(database.Col(domain.SessionFieldID), "sess_1"),
			),
			wantSQL:  "(((s.user_id < ? OR s.user_id IS NULL)) OR (s.user_id = ? AND (s.id < ? OR s.id IS NULL)))",
			wantArgs: []any{"usr_1", "usr_1", "sess_1"},
		},
		{
			name:     "range filter keeps plain compare",
			filter:   database.LessThan(database.Col(domain.SessionFieldUserID), "usr_1"),
			wantSQL:  "s.user_id < ?",
			wantArgs: []any{"usr_1"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var c statementCompiler
			compileFilter(&c, tt.filter, sessionSchema)
			assert.Equal(t, tt.wantSQL, c.String())
			assert.Equal(t, tt.wantArgs, c.args)
		})
	}
}
