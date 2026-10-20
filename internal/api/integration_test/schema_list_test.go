//go:build postgres_integration || spanner_integration

package integration_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

// GET /schemas pages with a cursor (#924): a page-token walk covers every
// revision exactly once, each page but the last carries a token, the final
// page carries none even when it is full (#849), and a malformed token is
// rejected rather than silently ignored.
func TestListSchemasPagination(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	const objectType = "list-schemas-pagination"
	for i := range 3 {
		doc := fmt.Sprintf(`{
			"title": "revision %d",
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			"objectType": %q,
			"metaSchema": "%s/user-schema.json",
			"kind": "user-schema",
			"type": "object",
			"x-auth-methods": {
				"passkey": { "enabled": true }
			},
			"properties": {
				"prop%d": { "type": "string" }
			}
		}`, i, objectType, helpers.BuiltinSchemaBaseURL, i)
		sch := api.UserSchema{}
		require.NoError(t, sch.UnmarshalJSON([]byte(doc)))
		resp, err := client.CreateSchema(
			t.Context(),
			api.CreateSchemaReq{Type: api.UserSchemaCreateSchemaReq, UserSchema: sch},
			api.CreateSchemaParams{ProjectID: api.ProjectID(project.ID)},
		)
		require.NoError(t, err)
		require.IsType(t, &api.CreateSchemaResponse{}, resp, helpers.MustMarshal(t, resp))
	}

	listSchemas := func(t *testing.T, params api.ListSchemasParams) *api.ListSchemasResponse {
		t.Helper()
		params.ProjectID = api.ProjectID(project.ID)
		params.ObjectType = api.NewOptString(objectType)
		res, err := client.ListSchemas(t.Context(), params)
		require.NoError(t, err)
		require.IsType(t, &api.ListSchemasResponse{}, res, helpers.MustMarshal(t, res))
		return res.(*api.ListSchemasResponse)
	}

	// The whole result fits in one page, so no cursor is emitted.
	full := listSchemas(t, api.ListSchemasParams{})
	require.Len(t, full.Schemas, 3)
	assert.False(t, full.NextPageToken.IsSet(), "the whole result fits in one page")
	wantIDs := make([]string, 0, len(full.Schemas))
	for _, item := range full.Schemas {
		wantIDs = append(wantIDs, item.ID)
	}

	// A limit-1 walk visits the same rows in the same order, exactly once. Each
	// page but the last carries a cursor; the final page has none, because
	// look-ahead sees no further row (#849) — there is no trailing empty page.
	var gotIDs []string
	var pageToken api.OptPageToken
	for range len(wantIDs) {
		page := listSchemas(t, api.ListSchemasParams{
			Limit:     api.NewOptLimit(1),
			PageToken: pageToken,
		})
		require.Len(t, page.Schemas, 1)
		gotIDs = append(gotIDs, page.Schemas[0].ID)
		token, ok := page.NextPageToken.Get()
		if len(gotIDs) == len(wantIDs) {
			assert.False(t, ok, "the final page carries no cursor")
			break
		}
		require.True(t, ok, "a non-final full page carries a cursor")
		pageToken = api.NewOptPageToken(token)
	}
	assert.Equal(t, wantIDs, gotIDs, "paging must cover the list in order, each row exactly once")

	// A token the server never minted is rejected, not ignored.
	t.Run("malformed page token", func(t *testing.T) {
		res, err := client.ListSchemas(t.Context(), api.ListSchemasParams{
			ProjectID: api.ProjectID(project.ID),
			PageToken: api.NewOptPageToken("not-a-cursor"),
		})
		require.NoError(t, err)
		require.IsType(t, &api.ListSchemasErrorResponseStatusCode{}, res, helpers.MustMarshal(t, res))
		errRes := res.(*api.ListSchemasErrorResponseStatusCode)
		assert.Equal(t, http.StatusBadRequest, errRes.StatusCode)
		assert.Equal(t, api.ListSchemasErrorResponseType(domain.ErrRequestInvalid().Code), errRes.Response.Type)
	})
}

// GET /schemas answers two cardinalities from one endpoint (#923): `all` is the
// revision history `schemas list` reads, `latest` is the one-row-per-schema the
// console directory shows. Which one is being asked for is a parameter of its
// own, so both stay reachable with or without an object_type filter.
func TestListSchemasRevisions(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	createSchema := func(t *testing.T, title, objectType string) string {
		t.Helper()
		doc := fmt.Sprintf(`{
			"title": %q,
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			"objectType": %q,
			"metaSchema": "%s/user-schema.json",
			"kind": "user-schema",
			"type": "object",
			"x-auth-methods": {
				"passkey": { "enabled": true }
			},
			"properties": {
				"givenName": { "type": "string" }
			}
		}`, title, objectType, helpers.BuiltinSchemaBaseURL)
		sch := api.UserSchema{}
		require.NoError(t, sch.UnmarshalJSON([]byte(doc)))
		resp, err := client.CreateSchema(
			t.Context(),
			api.CreateSchemaReq{Type: api.UserSchemaCreateSchemaReq, UserSchema: sch},
			api.CreateSchemaParams{ProjectID: api.ProjectID(project.ID)},
		)
		require.NoError(t, err)
		require.IsType(t, &api.CreateSchemaResponse{}, resp, helpers.MustMarshal(t, resp))
		return resp.(*api.CreateSchemaResponse).ID
	}

	const (
		consumer = "list-schemas-revisions-consumer"
		business = "list-schemas-revisions-business"
	)
	consumerV1 := createSchema(t, "consumer v1", consumer)
	consumerV2 := createSchema(t, "consumer v2", consumer)
	businessV1 := createSchema(t, "business v1", business)
	// A document fetched by URL is stored unparsed (#812), so its row carries
	// no object type whatever the document declares. Such a row is a revision
	// of nothing.
	orphanRow := &domain.JSONSchema{
		ProjectID: project.ID,
		Kind:      domain.JSONSchemaKindUnknown,
		Schema: []byte(fmt.Sprintf(`{
			"title": "no object type",
			"objectType": "list-schemas-revisions-orphan",
			"metaSchema": "%s/user-schema.json",
			"kind": "user-schema",
			"x-auth-methods": {"passkey": {"enabled": true}}
		}`, helpers.BuiltinSchemaBaseURL)),
	}
	require.NoError(t, harness.EnsureServiceDB(t).Statements().CreateJSONSchema(t.Context(), orphanRow))
	orphan := orphanRow.URL

	list := func(t *testing.T, params api.ListSchemasParams) *api.ListSchemasResponse {
		t.Helper()
		params.ProjectID = api.ProjectID(project.ID)
		res, err := client.ListSchemas(t.Context(), params)
		require.NoError(t, err)
		require.IsType(t, &api.ListSchemasResponse{}, res, helpers.MustMarshal(t, res))
		return res.(*api.ListSchemasResponse)
	}
	ids := func(resp *api.ListSchemasResponse) []string {
		out := make([]string, 0, len(resp.Schemas))
		for _, item := range resp.Schemas {
			out = append(out, item.ID)
		}
		return out
	}

	latestParam := api.NewOptListSchemasRevisions(api.ListSchemasRevisionsLatest)

	t.Run("all is the default and keeps every revision", func(t *testing.T) {
		got := ids(list(t, api.ListSchemasParams{ObjectType: api.NewOptString(consumer)}))
		assert.Equal(t, []string{consumerV2, consumerV1}, got, "newest first")

		explicit := ids(list(t, api.ListSchemasParams{
			ObjectType: api.NewOptString(consumer),
			Revisions:  api.NewOptListSchemasRevisions(api.ListSchemasRevisionsAll),
		}))
		assert.Equal(t, got, explicit, "the default and the explicit value are the same request")
	})

	t.Run("latest keeps one revision per object type", func(t *testing.T) {
		got := ids(list(t, api.ListSchemasParams{Revisions: latestParam}))
		assert.Contains(t, got, consumerV2)
		assert.Contains(t, got, businessV1)
		assert.NotContains(t, got, consumerV1, "a superseded revision is not current")
		// Grouping a row with no object type would have to invent a group; it is
		// returned instead of silently dropped.
		assert.Contains(t, got, orphan)
	})

	t.Run("latest narrows to one schema when an object type is given", func(t *testing.T) {
		got := ids(list(t, api.ListSchemasParams{
			ObjectType: api.NewOptString(consumer),
			Revisions:  latestParam,
		}))
		assert.Equal(t, []string{consumerV2}, got)
	})

	t.Run("paging latest visits each schema exactly once", func(t *testing.T) {
		var got []string
		var pageToken api.OptPageToken
		for pages := 0; ; pages++ {
			require.Less(t, pages, 20, "paging did not terminate")
			page := list(t, api.ListSchemasParams{
				Revisions: latestParam,
				Limit:     api.NewOptLimit(1),
				PageToken: pageToken,
			})
			got = append(got, ids(page)...)
			token, ok := page.NextPageToken.Get()
			if !ok {
				break
			}
			pageToken = api.NewOptPageToken(token)
		}
		assert.Equal(t, 1, countOccurrences(got, consumerV2))
		assert.Equal(t, 1, countOccurrences(got, businessV1))
		assert.Equal(t, 1, countOccurrences(got, orphan))
		assert.Zero(t, countOccurrences(got, consumerV1))
	})

	// Both modes sort by the same columns, so the keyset predicate alone cannot
	// tell that the row set underneath it changed. The token carries the mode.
	t.Run("a token from the other mode is rejected", func(t *testing.T) {
		first := list(t, api.ListSchemasParams{Limit: api.NewOptLimit(1)})
		token, ok := first.NextPageToken.Get()
		require.True(t, ok, "a full page carries a cursor")

		res, err := client.ListSchemas(t.Context(), api.ListSchemasParams{
			ProjectID: api.ProjectID(project.ID),
			Revisions: latestParam,
			Limit:     api.NewOptLimit(1),
			PageToken: api.NewOptPageToken(token),
		})
		require.NoError(t, err)
		require.IsType(t, &api.ListSchemasErrorResponseStatusCode{}, res, helpers.MustMarshal(t, res))
		errRes := res.(*api.ListSchemasErrorResponseStatusCode)
		assert.Equal(t, http.StatusBadRequest, errRes.StatusCode)
		assert.Equal(t, api.ListSchemasErrorResponseType(domain.ErrRequestInvalid().Code), errRes.Response.Type)
	})
}

func countOccurrences(haystack []string, needle string) int {
	n := 0
	for _, item := range haystack {
		if item == needle {
			n++
		}
	}
	return n
}

// expand=in_use reports per revision whether any user is on it, and is absent
// unless asked for. Its gate is pinned by TestConsoleSessionSchemaInUseNeedsProjectRead.
func TestListSchemasInUse(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	const objectType = "list-schemas-in-use"
	createSchema := func(t *testing.T, title string) string {
		t.Helper()
		doc := fmt.Sprintf(`{
			"title": %q,
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			"objectType": %q,
			"metaSchema": "%s/user-schema.json",
			"kind": "user-schema",
			"type": "object",
			"x-auth-methods": {
				"passkey": { "enabled": true }
			},
			"properties": {
				"givenName": { "type": "string" }
			}
		}`, title, objectType, helpers.BuiltinSchemaBaseURL)
		sch := api.UserSchema{}
		require.NoError(t, sch.UnmarshalJSON([]byte(doc)))
		resp, err := client.CreateSchema(
			t.Context(),
			api.CreateSchemaReq{Type: api.UserSchemaCreateSchemaReq, UserSchema: sch},
			api.CreateSchemaParams{ProjectID: api.ProjectID(project.ID)},
		)
		require.NoError(t, err)
		require.IsType(t, &api.CreateSchemaResponse{}, resp, helpers.MustMarshal(t, resp))
		return resp.(*api.CreateSchemaResponse).ID
	}
	v1 := createSchema(t, "in use v1")
	v2 := createSchema(t, "in use v2")

	email, err := domain.NewCreateAttribute("email", helpers.RandString(8)+"@example.com", domain.AttributeUniquenessProject)
	require.NoError(t, err)
	require.NoError(t, harness.EnsureUserFixture(t).Create(t.Context(), &domain.CreateUser{
		ProjectID:  project.ID,
		SchemaURL:  v1,
		ID:         "user_" + helpers.RandString(8),
		Attributes: domain.CreateAttributes{*email},
	}))

	listInUse := func(t *testing.T, client *helpers.ApiClient, expand []api.SchemaExpand) map[string]api.OptBool {
		t.Helper()
		res, err := client.ListSchemas(t.Context(), api.ListSchemasParams{
			ProjectID:  api.ProjectID(project.ID),
			ObjectType: api.NewOptString(objectType),
			Expand:     expand,
		})
		require.NoError(t, err)
		require.IsType(t, &api.ListSchemasResponse{}, res, helpers.MustMarshal(t, res))
		inUse := make(map[string]api.OptBool)
		for _, schema := range res.(*api.ListSchemasResponse).Schemas {
			inUse[schema.ID] = schema.Metadata.InUse
		}
		return inUse
	}
	expandInUse := []api.SchemaExpand{api.SchemaExpandInUse}

	t.Run("absent unless asked for", func(t *testing.T) {
		assert.Equal(t, map[string]api.OptBool{v1: {}, v2: {}}, listInUse(t, client, nil))
	})

	t.Run("marks each revision", func(t *testing.T) {
		assert.Equal(t, map[string]api.OptBool{v1: api.NewOptBool(true), v2: api.NewOptBool(false)}, listInUse(t, client, expandInUse))
	})

}
