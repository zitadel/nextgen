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
