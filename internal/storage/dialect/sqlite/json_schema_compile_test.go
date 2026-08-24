package sqlite

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

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
