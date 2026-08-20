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

func createJSONSchemaWithKind(t *testing.T, stmts service.AllStatements, projectID, url string, kind *string) {
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

		kind := "user-schema"
		withKind := "https://example.com/schemas/kind-" + suffix
		createJSONSchemaWithKind(t, d.stmts, projectID, withKind, &kind)

		got, err := d.stmts.GetJSONSchemaByID(t.Context(), projectID, withKind)
		require.NoError(t, err)
		require.NotNil(t, got.Kind)
		assert.Equal(t, "user-schema", *got.Kind)

		// Schemas ingested by URL and $ref targets pulled in during resolution
		// are stored without a kind (#812); the column has to accept that.
		withoutKind := "https://example.com/schemas/nokind-" + suffix
		createJSONSchemaWithKind(t, d.stmts, projectID, withoutKind, nil)

		got, err = d.stmts.GetJSONSchemaByID(t.Context(), projectID, withoutKind)
		require.NoError(t, err)
		assert.Nil(t, got.Kind)
	})
}

func TestJSONSchemaStatements_ListFilterByKind(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		suffix := uniqueSuffix(t)

		userSchema, otherKind := "user-schema", "flow-definition"
		wanted := "https://example.com/schemas/wanted-" + suffix
		createJSONSchemaWithKind(t, d.stmts, projectID, wanted, &userSchema)
		createJSONSchemaWithKind(t, d.stmts, projectID, "https://example.com/schemas/other-"+suffix, &otherKind)
		createJSONSchemaWithKind(t, d.stmts, projectID, "https://example.com/schemas/null-"+suffix, nil)

		result, err := d.stmts.ListJSONSchemas(unfilteredListCtx(t), &database.ListOptions[domain.JSONSchemaField]{
			Filter: database.And(
				database.Equal(database.Col(domain.JSONSchemaFieldProjectID), projectID),
				database.Equal(database.Col(domain.JSONSchemaFieldKind), userSchema),
			),
		})
		require.NoError(t, err)

		urls := make([]string, 0, len(result.Items))
		for _, item := range result.Items {
			urls = append(urls, item.URL)
		}
		// A different kind is excluded, and so is a NULL kind — an equality
		// filter must not let unkinded rows through.
		assert.Equal(t, []string{wanted}, urls)
	})
}
