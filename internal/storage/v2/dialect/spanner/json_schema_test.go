//go:build spanner_integration

package spanner

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestJSONSchemaStatements_CRUD(t *testing.T) {
	ctx := t.Context()
	stmts := testClient.Statements()

	project := newTestProject(uniqueProjectID(t))
	require.NoError(t, stmts.CreateProject(ctx, project))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), project.ID) })

	schemaURL := "https://example.test/schemas/user.v1.json"
	objectType := "user"
	schema := &domain.JSONSchema{
		ProjectID:  project.ID,
		URL:        schemaURL,
		ObjectType: &objectType,
		Schema:     []byte(`{"type":"object","properties":{"name":{"type":"string"}},"objectType":"user"}`),
	}
	require.NoError(t, stmts.CreateJSONSchema(ctx, schema))
	assert.False(t, schema.CreatedAt.IsZero())
	t.Cleanup(func() { _ = stmts.DeleteJSONSchemaByID(context.Background(), project.ID, schemaURL) })

	got, err := stmts.GetJSONSchemaByID(ctx, project.ID, schemaURL)
	require.NoError(t, err)
	assert.Equal(t, project.ID, got.ProjectID)
	assert.Equal(t, schemaURL, got.URL)
	require.NotNil(t, got.ObjectType)
	assert.Equal(t, objectType, *got.ObjectType)
	assert.Contains(t, string(got.Schema), `"type":"object"`)
	assert.Equal(t, schema.CreatedAt.UTC(), got.CreatedAt.UTC())

	listed, err := stmts.ListJSONSchemas(ctx, &database.ListOptions[domain.JSONSchemaField]{
		Filter: database.Equal(database.Col(domain.JSONSchemaFieldProjectID), project.ID),
		Pagination: database.Page[domain.JSONSchemaField]{
			Limit: 10,
			OrderBy: database.OrderBy[domain.JSONSchemaField]{
				Columns: []database.Column[domain.JSONSchemaField]{database.Col(domain.JSONSchemaFieldCreatedAt)},
			},
		},
	})
	require.NoError(t, err)
	require.Len(t, listed.Items, 1)
	assert.Equal(t, schemaURL, listed.Items[0].URL)

	require.NoError(t, stmts.DeleteJSONSchemaByID(ctx, project.ID, schemaURL))

	_, err = stmts.GetJSONSchemaByID(ctx, project.ID, schemaURL)
	require.Error(t, err)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}
