//go:build postgres_integration

package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func uniqueJSONSchemaIDs(t *testing.T) (projectID, schemaURL string) {
	t.Helper()
	suffix := uniqueSuffix(t)
	return "proj-schema-" + suffix, "https://example.test/schemas/" + suffix + ".json"
}

func ensureJSONSchemaProject(t *testing.T, projectID string) {
	t.Helper()
	project := newTestProject(projectID)
	require.NoError(t, testPool.CreateProject(t.Context(), project))
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })
}

func TestJSONSchemaStatements_CRUD(t *testing.T) {
	projectID, schemaURL := uniqueJSONSchemaIDs(t)
	ensureJSONSchemaProject(t, projectID)

	objectType := "user"
	schema := &domain.JSONSchema{
		ProjectID:  projectID,
		URL:        schemaURL,
		ObjectType: &objectType,
		Schema:     []byte(`{"type":"object","properties":{"name":{"type":"string"}},"objectType":"user"}`),
	}
	require.NoError(t, testPool.CreateJSONSchema(t.Context(), schema))
	assert.False(t, schema.CreatedAt.IsZero())
	assert.WithinDuration(t, time.Now(), schema.CreatedAt, 5*time.Second)
	t.Cleanup(func() { _ = testPool.DeleteJSONSchemaByID(context.Background(), projectID, schemaURL) })

	got, err := testPool.GetJSONSchemaByID(t.Context(), projectID, schemaURL)
	require.NoError(t, err)
	assert.Equal(t, projectID, got.ProjectID)
	assert.Equal(t, schemaURL, got.URL)
	require.NotNil(t, got.ObjectType)
	assert.Equal(t, objectType, *got.ObjectType)
	assert.Contains(t, string(got.Schema), `"type":"object"`)
	assert.False(t, got.CreatedAt.IsZero())

	listed, err := testPool.ListJSONSchemas(t.Context(), &database.ListOptions[domain.JSONSchemaField]{
		Filter: database.Equal(database.Col(domain.JSONSchemaFieldProjectID), projectID),
		Pagination: database.Page[domain.JSONSchemaField]{
			OrderBy: database.OrderBy[domain.JSONSchemaField]{
				Columns:   []database.Column[domain.JSONSchemaField]{database.Col(domain.JSONSchemaFieldCreatedAt)},
				Direction: database.OrderDesc,
			},
		},
	})
	require.NoError(t, err)
	require.Len(t, listed.Items, 1)
	assert.Equal(t, schemaURL, listed.Items[0].URL)

	require.NoError(t, testPool.DeleteJSONSchemaByID(t.Context(), projectID, schemaURL))

	_, err = testPool.GetJSONSchemaByID(t.Context(), projectID, schemaURL)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestJSONSchemaStatements_Get_NotFound(t *testing.T) {
	projectID, schemaURL := uniqueJSONSchemaIDs(t)
	ensureJSONSchemaProject(t, projectID)

	_, err := testPool.GetJSONSchemaByID(t.Context(), projectID, schemaURL)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestJSONSchemaStatements_Create_Duplicate(t *testing.T) {
	projectID, schemaURL := uniqueJSONSchemaIDs(t)
	ensureJSONSchemaProject(t, projectID)

	schema := &domain.JSONSchema{
		ProjectID: projectID,
		URL:       schemaURL,
		Schema:    []byte(`{"type":"object"}`),
	}
	require.NoError(t, testPool.CreateJSONSchema(t.Context(), schema))
	t.Cleanup(func() { _ = testPool.DeleteJSONSchemaByID(context.Background(), projectID, schemaURL) })

	err := testPool.CreateJSONSchema(t.Context(), &domain.JSONSchema{
		ProjectID: projectID,
		URL:       schemaURL,
		Schema:    []byte(`{"type":"object"}`),
	})
	assert.Error(t, err)
}
