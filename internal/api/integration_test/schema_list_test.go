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
// revision exactly once, a full page carries a token, the page past the end
// does not, and a malformed token is rejected rather than silently ignored.
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
				"password": { "enabled": true }
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

	// A limit-1 walk visits the same rows in the same order, exactly once.
	// Every full page carries a cursor; only the page past the end is empty.
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
		require.True(t, ok, "a full page carries a cursor")
		pageToken = api.NewOptPageToken(token)
	}
	assert.Equal(t, wantIDs, gotIDs, "paging must cover the list in order, each row exactly once")

	past := listSchemas(t, api.ListSchemasParams{
		Limit:     api.NewOptLimit(1),
		PageToken: pageToken,
	})
	assert.Empty(t, past.Schemas)
	assert.False(t, past.NextPageToken.IsSet())

	// A token the server never minted is rejected, not ignored.
	t.Run("malformed page token", func(t *testing.T) {
		res, err := client.ListSchemas(t.Context(), api.ListSchemasParams{
			ProjectID: api.ProjectID(project.ID),
			PageToken: api.NewOptPageToken("not-a-cursor"),
		})
		require.NoError(t, err)
		require.IsType(t, &api.ErrorDetailsStatusCode{}, res, helpers.MustMarshal(t, res))
		errRes := res.(*api.ErrorDetailsStatusCode)
		assert.Equal(t, http.StatusBadRequest, errRes.StatusCode)
		assert.Equal(t, api.ErrorCode(domain.ErrRequestInvalid().Code), errRes.Response.Code)
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

	createSchema := func(t *testing.T, title, objectTypeField string) string {
		t.Helper()
		doc := fmt.Sprintf(`{
			"title": %q,
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			%s
			"metaSchema": "%s/user-schema.json",
			"kind": "user-schema",
			"type": "object",
			"x-auth-methods": {
				"password": { "enabled": true }
			},
			"properties": {
				"givenName": { "type": "string" }
			}
		}`, title, objectTypeField, helpers.BuiltinSchemaBaseURL)
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
	consumerV1 := createSchema(t, "consumer v1", fmt.Sprintf(`"objectType": %q,`, consumer))
	consumerV2 := createSchema(t, "consumer v2", fmt.Sprintf(`"objectType": %q,`, consumer))
	businessV1 := createSchema(t, "business v1", fmt.Sprintf(`"objectType": %q,`, business))
	// objectType is optional in the meta-schema, and #812 keeps producing rows
	// without one by other routes. Such a row is a revision of nothing.
	orphan := createSchema(t, "no object type", "")

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
		require.IsType(t, &api.ErrorDetailsStatusCode{}, res, helpers.MustMarshal(t, res))
		errRes := res.(*api.ErrorDetailsStatusCode)
		assert.Equal(t, http.StatusBadRequest, errRes.StatusCode)
		assert.Equal(t, api.ErrorCode(domain.ErrRequestInvalid().Code), errRes.Response.Code)
	})
}

// GET /schemas?id= resolves a set of ids a caller already holds (#940): the
// console's flow directory reads the schema each flow definition pins, and one
// filtered list beats one request per id. Ids are revision-specific, so the
// filter has to answer for superseded revisions as well as current ones.
func TestListSchemasIDFilter(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	const (
		consumer = "list-schemas-ids-consumer"
		business = "list-schemas-ids-business"
	)
	consumerV1 := createIDFilterSchema(t, client, project.ID, "consumer v1", consumer)
	consumerV2 := createIDFilterSchema(t, client, project.ID, "consumer v2", consumer)
	businessV1 := createIDFilterSchema(t, client, project.ID, "business v1", business)

	list := func(t *testing.T, params api.ListSchemasParams) []string {
		t.Helper()
		params.ProjectID = api.ProjectID(project.ID)
		res, err := client.ListSchemas(t.Context(), params)
		require.NoError(t, err)
		require.IsType(t, &api.ListSchemasResponse{}, res, helpers.MustMarshal(t, res))
		out := make([]string, 0, len(res.(*api.ListSchemasResponse).Schemas))
		for _, item := range res.(*api.ListSchemasResponse).Schemas {
			out = append(out, item.ID)
		}
		return out
	}

	t.Run("returns exactly the ids asked for", func(t *testing.T) {
		// consumerV1 is superseded by consumerV2, which the default `all` mode
		// keeps: a flow pins the revision it was created with, so an id filter
		// that only resolved current revisions would miss the common case.
		assert.Equal(t, []string{consumerV1}, list(t, api.ListSchemasParams{ID: []string{consumerV1}}))
		assert.ElementsMatch(t,
			[]string{consumerV1, businessV1},
			list(t, api.ListSchemasParams{ID: []string{consumerV1, businessV1}}),
		)
	})

	t.Run("an id that matches nothing is absent, not an error", func(t *testing.T) {
		assert.Empty(t, list(t, api.ListSchemasParams{ID: []string{"sch_does-not-exist"}}))
		assert.Equal(t,
			[]string{consumerV2},
			list(t, api.ListSchemasParams{ID: []string{consumerV2, "sch_does-not-exist"}}),
		)
	})

	t.Run("composes with the other filters", func(t *testing.T) {
		assert.ElementsMatch(t,
			[]string{consumerV1, businessV1},
			list(t, api.ListSchemasParams{
				ID:   []string{consumerV1, businessV1},
				Kind: api.NewOptListSchemasKind(api.ListSchemasKindUserSchema),
			}),
		)
		// AND, not OR: the object type narrows the id set rather than adding to it.
		assert.Equal(t,
			[]string{consumerV1},
			list(t, api.ListSchemasParams{
				ID:         []string{consumerV1, businessV1},
				ObjectType: api.NewOptString(consumer),
			}),
		)
	})

	// The filter narrows the rows the caller is already authorized for — every
	// query ANDs `project_id` — so a foreign id reads like an unknown one and
	// answers no existence question.
	t.Run("an id from another project is not reachable", func(t *testing.T) {
		other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		otherClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, otherClient, other)
		foreign := createIDFilterSchema(t, otherClient, other.ID, "other project", "list-schemas-ids-foreign")

		assert.Empty(t, list(t, api.ListSchemasParams{ID: []string{foreign}}))
		assert.Equal(t,
			[]string{consumerV1},
			list(t, api.ListSchemasParams{ID: []string{consumerV1, foreign}}),
		)
	})

	// The cap is declared on the parameter (maxItems), so an oversized request
	// is rejected before it reaches a filter chain of the same size.
	t.Run("more than 100 ids is rejected", func(t *testing.T) {
		ids := make([]string, 101)
		for i := range ids {
			ids[i] = fmt.Sprintf("sch_%03d", i)
		}
		res, err := client.ListSchemas(t.Context(), api.ListSchemasParams{
			ProjectID: api.ProjectID(project.ID),
			ID:        ids,
		})
		require.NoError(t, err)
		require.IsType(t, &api.ErrorDetailsStatusCode{}, res, helpers.MustMarshal(t, res))
		errRes := res.(*api.ErrorDetailsStatusCode)
		assert.Equal(t, http.StatusBadRequest, errRes.StatusCode)
		assert.Equal(t, api.ErrorCode(domain.ErrRequestInvalid().Code), errRes.Response.Code)
	})
}

func createIDFilterSchema(t *testing.T, client *helpers.ApiClient, projectID, title, objectType string) string {
	t.Helper()
	doc := fmt.Sprintf(`{
		"title": %q,
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"objectType": %q,
		"metaSchema": "%s/user-schema.json",
		"kind": "user-schema",
		"type": "object",
		"x-auth-methods": {
			"password": { "enabled": true }
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
		api.CreateSchemaParams{ProjectID: api.ProjectID(projectID)},
	)
	require.NoError(t, err)
	require.IsType(t, &api.CreateSchemaResponse{}, resp, helpers.MustMarshal(t, resp))
	return resp.(*api.CreateSchemaResponse).ID
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
