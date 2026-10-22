//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"slices"
	"testing"
	"time"

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

// createJSONSchemaRevision writes one revision of objectType and returns it with
// the created_at the dialect assigned.
func createJSONSchemaRevision(t *testing.T, stmts service.AllStatements, projectID, url string, objectType *string) *domain.JSONSchema {
	t.Helper()
	schema := &domain.JSONSchema{
		ProjectID:  projectID,
		URL:        url,
		ObjectType: objectType,
		Kind:       domain.JSONSchemaKindUserSchema,
		Schema:     []byte(`{"type":"object"}`),
	}
	require.NoError(t, stmts.CreateJSONSchema(t.Context(), schema))
	t.Cleanup(func() { _ = stmts.DeleteJSONSchemaByID(context.Background(), projectID, url) })
	return schema
}

func listJSONSchemaURLs(t *testing.T, stmts service.AllStatements, projectID string, opts service.JSONSchemaQueryOptions) []string {
	t.Helper()
	result, err := stmts.ListJSONSchemas(unfilteredListCtx(t), &database.ListOptions[domain.JSONSchemaField]{
		Filter: database.Equal(database.Col(domain.JSONSchemaFieldProjectID), projectID),
	}, opts)
	require.NoError(t, err)
	urls := make([]string, 0, len(result.Items))
	for _, item := range result.Items {
		urls = append(urls, item.URL)
	}
	slices.Sort(urls)
	return urls
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
		}, service.JSONSchemaQueryOptions{})
		require.NoError(t, err)

		urls := make([]string, 0, len(result.Items))
		for _, item := range result.Items {
			urls = append(urls, item.URL)
		}
		// An unparsed schema is excluded.
		assert.Equal(t, []string{wanted}, urls)
	})
}

func TestJSONSchemaStatements_ListLatestRevisionPerObjectType(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		suffix := uniqueSuffix(t)
		base := "https://example.com/schemas/" + suffix + "-"

		consumer := "consumer-" + suffix
		business := "business-" + suffix

		// Written in order, so each revision is newer than the one before it.
		consumerV1 := createJSONSchemaRevision(t, d.stmts, projectID, base+"consumer-v1", &consumer)
		consumerV2 := createJSONSchemaRevision(t, d.stmts, projectID, base+"consumer-v2", &consumer)
		businessV1 := createJSONSchemaRevision(t, d.stmts, projectID, base+"business-v1", &business)
		// #812 keeps producing rows without an object type. They are revisions of
		// nothing, so latest mode must pass them through rather than group them.
		orphan := createJSONSchemaRevision(t, d.stmts, projectID, base+"orphan", nil)

		require.True(t, consumerV1.CreatedAt.Before(consumerV2.CreatedAt),
			"revisions of one object type must not share a created_at")

		all := listJSONSchemaURLs(t, d.stmts, projectID, service.JSONSchemaQueryOptions{})
		assert.Equal(t, []string{businessV1.URL, consumerV1.URL, consumerV2.URL, orphan.URL}, all)

		latest := listJSONSchemaURLs(t, d.stmts, projectID, service.JSONSchemaQueryOptions{
			LatestRevisionPerObjectType: true,
		})
		assert.Equal(t, []string{businessV1.URL, consumerV2.URL, orphan.URL}, latest)
	})
}

// A row with no object_type is a revision of nothing, so any number of them may
// coexist. Spanner needs NULL_FILTERED on the unique index to agree; Postgres
// and SQLite treat NULLs as distinct on their own.
func TestJSONSchemaStatements_NullObjectTypesDoNotCollide(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		suffix := uniqueSuffix(t)

		for i := range 3 {
			createJSONSchemaRevision(t, d.stmts, projectID,
				"https://example.com/schemas/"+suffix+"-null-"+string(rune('a'+i)), nil)
		}

		assert.Len(t, listJSONSchemaURLs(t, d.stmts, projectID, service.JSONSchemaQueryOptions{}), 3)
	})
}

// Latest mode reads created_at as a total order within an object type, so two
// revisions sharing one has no determinate answer. The unique index rejects the
// second write instead of letting the ambiguity reach a reader.
func TestJSONSchemaStatements_RejectsTiedRevisionTimestamps(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		suffix := uniqueSuffix(t)
		objectType := "tied-" + suffix
		tiedAt := time.Now().UTC().Truncate(time.Microsecond)

		first := "https://example.com/schemas/" + suffix + "-first"
		require.NoError(t, d.insertJSONSchemaAt(t.Context(), projectID, first, &objectType, tiedAt))
		t.Cleanup(func() { _ = d.stmts.DeleteJSONSchemaByID(context.Background(), projectID, first) })

		second := "https://example.com/schemas/" + suffix + "-second"
		err := d.insertJSONSchemaAt(t.Context(), projectID, second, &objectType, tiedAt)
		assert.ErrorIs(t, err, new(database.UniqueError))

		// A different object type at the same instant is a different schema and
		// stays allowed.
		otherType := "untied-" + suffix
		other := "https://example.com/schemas/" + suffix + "-other"
		require.NoError(t, d.insertJSONSchemaAt(t.Context(), projectID, other, &otherType, tiedAt))
		t.Cleanup(func() { _ = d.stmts.DeleteJSONSchemaByID(context.Background(), projectID, other) })
	})
}
