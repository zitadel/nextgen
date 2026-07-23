//go:build spanner_integration

package spanner

import (
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dbtest"
	spannerdialect "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner/migration"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestJSONSchemaStatements_CRUD(t *testing.T) {
	ctx := t.Context()

	connector, stop, err := dbtest.Spanner(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	cfg, ok := connector.(*spannerdialect.Config)
	require.True(t, ok)

	db, err := sql.Open("spanner", cfg.DSN)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	require.NoError(t, migration.Migrate(ctx, db))

	dialect, err := DecodeConfig(cfg.DSN)
	require.NoError(t, err)
	pool, err := dialect.Connect(ctx)
	require.NoError(t, err)
	t.Cleanup(func() { _ = pool.Close(ctx) })

	stmts := pool.(*Client).Statements()

	projectID := "proj_v2_json_schema"
	schemaURL := "https://example.test/schemas/user.v1.json"
	require.NoError(t, stmts.CreateProject(ctx, &domain.Project{
		ID:             projectID,
		PreviewOrigins: []string{},
	}))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(ctx, projectID) })

	objectType := "user"
	schema := &domain.JSONSchema{
		ProjectID:  projectID,
		URL:        schemaURL,
		ObjectType: &objectType,
		Schema:     []byte(`{"type":"object","properties":{"name":{"type":"string"}},"objectType":"user"}`),
	}
	require.NoError(t, stmts.CreateJSONSchema(ctx, schema))
	assert.False(t, schema.CreatedAt.IsZero())
	t.Cleanup(func() { _ = stmts.DeleteJSONSchemaByID(ctx, projectID, schemaURL) })

	got, err := stmts.GetJSONSchemaByID(ctx, projectID, schemaURL)
	require.NoError(t, err)
	assert.Equal(t, projectID, got.ProjectID)
	assert.Equal(t, schemaURL, got.URL)
	require.NotNil(t, got.ObjectType)
	assert.Equal(t, objectType, *got.ObjectType)
	assert.Contains(t, string(got.Schema), `"type":"object"`)
	assert.Equal(t, schema.CreatedAt.UTC(), got.CreatedAt.UTC())

	listed, err := stmts.ListJSONSchemas(ctx, &v2database.ListOptions[domain.JSONSchemaField]{
		Filter: v2database.Equal(v2database.Col(domain.JSONSchemaFieldProjectID), projectID),
		Pagination: v2database.Page[domain.JSONSchemaField]{
			Limit: 10,
			OrderBy: v2database.OrderBy[domain.JSONSchemaField]{
				Columns: []v2database.Column[domain.JSONSchemaField]{v2database.Col(domain.JSONSchemaFieldCreatedAt)},
			},
		},
	})
	require.NoError(t, err)
	require.Len(t, listed.Items, 1)
	assert.Equal(t, schemaURL, listed.Items[0].URL)

	require.NoError(t, stmts.DeleteJSONSchemaByID(ctx, projectID, schemaURL))

	_, err = stmts.GetJSONSchemaByID(ctx, projectID, schemaURL)
	require.Error(t, err)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}
