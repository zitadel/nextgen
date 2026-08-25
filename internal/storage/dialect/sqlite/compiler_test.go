package sqlite

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
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

func TestCompileStringFilterContainsFoldUsesEscape(t *testing.T) {
	t.Parallel()

	var c statementCompiler
	compileFilter(&c, database.StringContainsFold(database.Col(domain.ProjectFieldName), `100%_a\b`), projectSchema)
	assert.Equal(t, `LOWER(name) LIKE LOWER('%' || ? || '%') ESCAPE '\'`, c.String())
	require.Len(t, c.args, 1)
	assert.Equal(t, `100\%\_a\\b`, c.args[0])
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

func TestCompileCompareFilterBoolEqual(t *testing.T) {
	t.Parallel()

	hasFactors := database.Col(domain.SessionFieldHasVerifiedFactors)
	existsSQL := sessionSchema.MustSQLName(domain.SessionFieldHasVerifiedFactors)

	var c statementCompiler
	compileFilter(&c, database.Equal(hasFactors, true), sessionSchema)
	assert.Equal(t, existsSQL, c.String())
	assert.Empty(t, c.args)

	var cNot statementCompiler
	compileFilter(&cNot, database.Equal(hasFactors, false), sessionSchema)
	assert.Equal(t, "NOT "+existsSQL, cNot.String())
	assert.Empty(t, cNot.args)
}

func TestCompileCorrelatedFilterBindsValueInline(t *testing.T) {
	t.Parallel()

	teamID := database.Col(domain.SessionFieldTeamID)

	var c statementCompiler
	compileFilter(&c, database.CorrelatedEqual(teamID, "team_01H"), sessionSchema)
	assert.Equal(t,
		sessionSchema.SQLName(teamID)+"?"+sessionSchema.SQLSuffix(teamID),
		c.String(),
		"the bound value must land between SQLName and SQLSuffix",
	)
	require.Len(t, c.args, 1)
	assert.Equal(t, "team_01H", c.args[0])

	// Args must stay in emission order across the surrounding filters, so the
	// correlated predicate composes like any other.
	var combined statementCompiler
	compileFilter(&combined, database.And(
		database.Equal(database.Col(domain.SessionFieldProjectID), "proj_01H"),
		database.CorrelatedEqual(teamID, "team_01H"),
	), sessionSchema)
	assert.Equal(t,
		"(s.project_id = ? AND "+sessionSchema.SQLName(teamID)+"?"+sessionSchema.SQLSuffix(teamID)+")",
		combined.String(),
	)
	require.Len(t, combined.args, 2)
	assert.Equal(t, []any{"proj_01H", "team_01H"}, combined.args)
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
			wantSQL: "id = ?",
			wantArg: "proj_1",
		},
		{
			name:    "greater than",
			filter:  database.GreaterThan(database.Col(domain.ProjectFieldCreatedAt), createdAt),
			wantSQL: "created_at > ?",
			wantArg: createdAt.UnixNano(),
		},
		{
			name:    "greater than or equal",
			filter:  database.GreaterThanOrEqual(database.Col(domain.ProjectFieldCreatedAt), createdAt),
			wantSQL: "created_at >= ?",
			wantArg: createdAt.UnixNano(),
		},
		{
			name:    "less than",
			filter:  database.LessThan(database.Col(domain.ProjectFieldCreatedAt), createdAt),
			wantSQL: "created_at < ?",
			wantArg: createdAt.UnixNano(),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var c statementCompiler
			compileFilter(&c, tt.filter, projectSchema)
			assert.Equal(t, tt.wantSQL, c.String())
			require.Len(t, c.args, 1)
			assert.Equal(t, tt.wantArg, c.args[0])
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

func TestCompileListRequiresAuthzFilter(t *testing.T) {
	t.Parallel()

	const stmt = "SELECT id FROM teams"
	opts := &database.ListOptions[domain.TeamField]{}

	var compiler statementCompiler
	err := compileList(context.Background(), &compiler, stmt, opts, teamSchema, "teams", "id")
	require.ErrorIs(t, err, authz.ErrListFilterRequired)

	ctx := service.WithAuthzListFilter(context.Background(), service.AuthzListFilter{
		AuthzCheckParams: domain.AuthzCheckParams{
			CatalogID: domain.SystemCatalogID, ProjectID: "proj_1", PrincipalHomeProjectID: "proj_1",
			PrincipalType: domain.AuthzPrincipalTypeSKProj, PrincipalID: "proj_1",
			ObjectType: "project", Relation: "viewer",
		},
		ResourceKind: domain.ResourceKindTeam,
	})
	compiler.Reset()
	require.NoError(t, compileList(ctx, &compiler, stmt, opts, teamSchema, "teams", "id"))
	assert.Contains(t, compiler.String(), "EXISTS")

	compiler.Reset()
	allowCtx := service.WithAuthzListSkipOnce(context.Background())
	require.NoError(t, compileList(allowCtx, &compiler, stmt, opts, teamSchema, "teams", "id"))
	assert.NotContains(t, compiler.String(), "EXISTS")
	compiler.Reset()
	require.ErrorIs(t, compileList(allowCtx, &compiler, stmt, opts, teamSchema, "teams", "id"), authz.ErrListFilterRequired)

	compiler.Reset()
	unrestricted := service.WithAuthzListUnrestricted(context.Background())
	require.NoError(t, compileList(unrestricted, &compiler, stmt, opts, teamSchema, "teams", "id"))
	assert.NotContains(t, compiler.String(), "EXISTS")
	compiler.Reset()
	require.NoError(t, compileList(unrestricted, &compiler, stmt, opts, teamSchema, "teams", "id"))

	nested := service.WithAuthzListUnrestricted(ctx)
	compiler.Reset()
	require.NoError(t, compileList(nested, &compiler, stmt, opts, teamSchema, "teams", "id"))
	assert.NotContains(t, compiler.String(), "EXISTS", "unrestricted must ignore an inherited filter")
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

// Latest mode adds one WHERE conjunct and nothing else: the statement stays a
// plain single-table SELECT, so the keyset predicate, the authz predicate,
// ORDER BY and LIMIT all keep applying to it unchanged.
func TestCompileListJSONSchemasLatestRevision(t *testing.T) {
	t.Parallel()

	opts := &database.ListOptions[domain.JSONSchemaField]{
		Filter: database.Equal(database.Col(domain.JSONSchemaFieldProjectID), "proj_1"),
		Pagination: database.Page[domain.JSONSchemaField]{
			Limit: 20,
			OrderBy: database.OrderBy[domain.JSONSchemaField]{
				Columns: []database.Column[domain.JSONSchemaField]{
					database.Col(domain.JSONSchemaFieldCreatedAt),
					database.Col(domain.JSONSchemaFieldURL),
				},
				Direction: database.OrderDesc,
			},
		},
	}
	ctx := service.WithAuthzListUnrestricted(context.Background())

	var compiler statementCompiler
	require.NoError(t, compileList(ctx, &compiler, jsonSchemaQuery, opts, jsonSchemaSchema, "json_schemas", "url"))
	assert.NotContains(t, compiler.String(), "NOT EXISTS", "all mode is the default")

	compiler.Reset()
	require.NoError(t, compileList(ctx, &compiler, jsonSchemaQuery, opts, jsonSchemaSchema, "json_schemas", "url", latestRevisionPerObjectType))
	sql := compiler.String()

	assert.Contains(t, sql, "project_id = ? AND NOT EXISTS (", "the anti-join is ANDed onto the caller's filter")
	// The inner alias shadows the table name, so the unqualified json_schemas
	// inside the sub-query resolves to the outer row.
	assert.Contains(t, sql, "FROM json_schemas AS newer WHERE newer.project_id = json_schemas.project_id")
	assert.Contains(t, sql, "ORDER BY created_at DESC, url DESC")
}
