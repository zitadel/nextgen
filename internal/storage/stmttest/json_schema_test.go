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

func createJSONSchemaWithKind(t *testing.T, stmts service.AllStatements, projectID, url, kind string) {
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
		createJSONSchemaWithKind(t, d.stmts, projectID, url, "user-schema")

		got, err := d.stmts.GetJSONSchemaByID(t.Context(), projectID, url)
		require.NoError(t, err)
		assert.Equal(t, "user-schema", got.Kind)
	})
}

func TestJSONSchemaStatements_ListFilterByKind(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		suffix := uniqueSuffix(t)

		wanted := "https://example.com/schemas/wanted-" + suffix
		createJSONSchemaWithKind(t, d.stmts, projectID, wanted, "user-schema")
		createJSONSchemaWithKind(t, d.stmts, projectID, "https://example.com/schemas/other-"+suffix, "flow-definition")
		// Schemas persisted without their document being parsed (#812) land here.
		createJSONSchemaWithKind(t, d.stmts, projectID, "https://example.com/schemas/unknown-"+suffix, domain.JSONSchemaKindUnknown)

		result, err := d.stmts.ListJSONSchemas(unfilteredListCtx(t), &database.ListOptions[domain.JSONSchemaField]{
			Filter: database.And(
				database.Equal(database.Col(domain.JSONSchemaFieldProjectID), projectID),
				database.Equal(database.Col(domain.JSONSchemaFieldKind), "user-schema"),
			),
		})
		require.NoError(t, err)

		urls := make([]string, 0, len(result.Items))
		for _, item := range result.Items {
			urls = append(urls, item.URL)
		}
		// Both a different kind and an unparsed one are excluded.
		assert.Equal(t, []string{wanted}, urls)
	})
}
