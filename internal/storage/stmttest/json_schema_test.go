//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func createJSONSchemaWithKind(t *testing.T, stmts service.AllStatements, projectID, url string, kind domain.JSONSchemaKind) {
	t.Helper()
	require.NoError(t, stmts.CreateJSONSchema(t.Context(), &domain.JSONSchema{
		ProjectID: projectID,
		URL:       url,
		Kind:      kind,
		Schema:    []byte(`{"type":"object"}`),
	}))
	t.Cleanup(func() { _ = stmts.DeleteJSONSchemaByID(context.Background(), projectID, url) })
}

func TestJSONSchemaStatements_KindRoundTrips(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		suffix := uniqueSuffix(t)

		url := "https://example.com/schemas/kind-" + suffix
		createJSONSchemaWithKind(t, d.stmts, projectID, url, domain.JSONSchemaKindUserSchema)

		got, err := d.stmts.GetJSONSchemaByID(t.Context(), projectID, url)
		require.NoError(t, err)
		assert.Equal(t, domain.JSONSchemaKindUserSchema, got.Kind)
	})
}

func TestJSONSchemaStatements_ListFilterByKind(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		suffix := uniqueSuffix(t)

		wanted := "https://example.com/schemas/wanted-" + suffix
		createJSONSchemaWithKind(t, d.stmts, projectID, wanted, domain.JSONSchemaKindUserSchema)
		// Schemas persisted without their document being parsed (#812) land here.
		createJSONSchemaWithKind(t, d.stmts, projectID, "https://example.com/schemas/unknown-"+suffix, domain.JSONSchemaKindUnknown)

		result, err := d.stmts.ListJSONSchemas(unfilteredListCtx(t), &database.ListOptions[domain.JSONSchemaField]{
			Filter: database.And(
				database.Equal(database.Col(domain.JSONSchemaFieldProjectID), projectID),
				database.Equal(database.Col(domain.JSONSchemaFieldKind), domain.JSONSchemaKindUserSchema.String()),
			),
		})
		require.NoError(t, err)

		urls := make([]string, 0, len(result.Items))
		for _, item := range result.Items {
			urls = append(urls, item.URL)
		}
		// An unparsed schema is excluded.
		assert.Equal(t, []string{wanted}, urls)
	})
}
