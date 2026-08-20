//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
)

func TestCreateSchema(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		testCases := []struct {
			name   string
			schema string
		}{
			{
				name:   "user-schema in body",
				schema: harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema,
			},
			// TODO: add this test case once we have a public github-repo from which to get a schema
			//{
			//	name: "user-schema by url",
			//	req:  harness.Schemas.CreateSchemaRequestUserSchemaByUrl,
			//},
		}

		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()

				apiSchema := api.UserSchema{}
				err := apiSchema.UnmarshalJSON([]byte(tc.schema))
				require.NoError(t, err)

				req := api.CreateSchemaReq{
					Type:       api.UserSchemaCreateSchemaReq,
					UserSchema: apiSchema,
				}
				params := api.CreateSchemaParams{
					ProjectID: api.ProjectID(project.ID),
				}

				resp, err := client.CreateSchema(t.Context(), req, params)
				assert.NoError(t, err)

				assert.IsType(t, &api.CreateSchemaResponse{}, resp, helpers.MustMarshal(t, resp))
			})
		}
	})

	t.Run("error", func(t *testing.T) {
		t.Parallel()

		t.Run("schema without known kind", func(t *testing.T) {
			t.Parallel()

			body, err := json.Marshal(map[string]any{
				"metaSchema": "https://json-schema.org/draft/2020-12/schema",
				"$id":        "https://example.com/my-invalid-schema.json",
				"kind":       "does not exist",
				"title":      "an invalid user schema",
				"x-auth-methods": map[string]any{
					"password": map[string]any{
						"enabled": true,
					},
				},
			})
			require.NoError(t, err)

			apiSchema := api.UserSchema{}
			err = apiSchema.UnmarshalJSON(body)
			require.NoError(t, err)

			req := api.CreateSchemaReq{
				Type:       api.UserSchemaCreateSchemaReq,
				UserSchema: apiSchema,
			}
			params := api.CreateSchemaParams{
				ProjectID: api.ProjectID(project.ID),
			}

			resp, err := client.CreateSchema(t.Context(), req, params)
			assert.NoError(t, err)
			assert.IsType(t, &api.CreateSchemaBadRequest{}, resp, helpers.MustMarshal(t, resp))
		})

		t.Run("duplicates are not allowed", func(t *testing.T) {
			t.Parallel()

			schema := fmt.Sprintf(
				`{
                  "title": "without id",
                  "$schema": "https://json-schema.org/draft/2020-12/schema",
                  "$id": "duplicate-id",
                  "metaSchema": "%s/user-schema.json",
                  "kind": "user-schema",
                  "type": "object",
                  "x-auth-methods": {
                    "password": { "enabled": true }
                  },
                  "properties": {
                    "givenName": { "type": "string" }
                  }
                }
                `, helpers.BuiltinSchemaBaseURL)

			project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
			require.NoError(t, err)
			harness.CreateUserSchema(t, project, schema)

			apiSchema := api.UserSchema{}
			err = apiSchema.UnmarshalJSON([]byte(schema))
			require.NoError(t, err)

			client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
			require.NoError(t, err)
			harness.SetProjectSecretOnApiClient(t, client, project)

			req := api.CreateSchemaReq{
				Type:       api.UserSchemaCreateSchemaReq,
				UserSchema: apiSchema,
			}
			params := api.CreateSchemaParams{
				ProjectID: api.ProjectID(project.ID),
			}

			resp, err := client.CreateSchema(t.Context(), req, params)
			assert.NoError(t, err)

			assert.IsType(t, &api.CreateSchemaConflict{}, resp, helpers.MustMarshal(t, resp))
		})
	})
}

func TestGetSchema(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		t.Run("simple", func(t *testing.T) {
			t.Parallel()

			// Omit $id so Create mints a unique sch_* id. The shared fixture's
			// URL-shaped $id contains '/' segments that ogen rejects as a leaf
			// path param; composite RSI PK (#809) scopes URL reuse per project.
			schemaJSON := []byte(harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)
			var schemaObj map[string]any
			require.NoError(t, json.Unmarshal(schemaJSON, &schemaObj))
			delete(schemaObj, "$id")
			schemaJSON, err := json.Marshal(schemaObj)
			require.NoError(t, err)

			schemaID := harness.CreateUserSchema(t, project, string(schemaJSON))
			require.True(t, strings.HasPrefix(schemaID, "sch_"), "want managed sch_* id, got %q", schemaID)

			resp, err := client.GetSchemaById(t.Context(), api.GetSchemaByIdParams{
				ID: schemaID,
			})
			assert.NoError(t, err)

			assert.IsType(t, &api.GetSchemaByIdOK{}, resp, helpers.MustMarshal(t, resp))
		})
	})

	t.Run("error", func(t *testing.T) {
		t.Parallel()

		t.Run("schema not found", func(t *testing.T) {
			t.Parallel()

			resp, err := client.GetSchemaById(t.Context(), api.GetSchemaByIdParams{
				ID: "does-not-exist",
			})
			assert.NoError(t, err)

			assert.IsType(t, &api.GetSchemaByIdNotFound{}, resp, helpers.MustMarshal(t, resp))
		})
	})
}

func TestSchemaRevisions(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	testCases := []struct {
		name            string
		objectType      string
		schemaRevisions []string
	}{
		{
			name:       "client does not provision ID",
			objectType: "client-does-not-provision-id",
			schemaRevisions: []string{
				fmt.Sprintf(
					`{
                  "title": "without id",
                  "$schema": "https://json-schema.org/draft/2020-12/schema",
                  "objectType": "client-does-not-provision-id",
                  "metaSchema": "%s/user-schema.json",
                  "kind": "user-schema",
                  "type": "object",
                  "x-auth-methods": {
                    "password": { "enabled": true }
                  },
                  "properties": {
                    "givenName": { "type": "string" }
                  }
                }
                `, helpers.BuiltinSchemaBaseURL),
				fmt.Sprintf(
					`{
                  "title": "without id",
                  "$schema": "https://json-schema.org/draft/2020-12/schema",
                  "objectType": "client-does-not-provision-id",
                  "metaSchema": "%s/user-schema.json",
                  "kind": "user-schema",
                  "type": "object",
                  "x-auth-methods": {
                    "password": { "enabled": true }
                  },
                  "properties": {
                    "firstName": { "type": "string" }
                  }
                }
                `, helpers.BuiltinSchemaBaseURL),
				fmt.Sprintf(
					`{
                  "title": "without id",
                  "$schema": "https://json-schema.org/draft/2020-12/schema",
                  "objectType": "client-does-not-provision-id",
                  "metaSchema": "%s/user-schema.json",
                  "kind": "user-schema",
                  "type": "object",
                  "x-auth-methods": {
                    "password": { "enabled": true }
                  },
                  "properties": {
                    "givenName": { "type": "string" }
                  }
                }
                `, helpers.BuiltinSchemaBaseURL),
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			var lastCreatedID string
			for _, rev := range tc.schemaRevisions {
				sch := api.UserSchema{}
				err := sch.UnmarshalJSON([]byte(rev))
				require.NoError(t, err)

				resp, err := client.CreateSchema(
					t.Context(),
					api.CreateSchemaReq{Type: api.UserSchemaCreateSchemaReq, UserSchema: sch},
					api.CreateSchemaParams{ProjectID: api.ProjectID(project.ID)},
				)
				require.NoError(t, err)
				if assert.IsType(t, &api.CreateSchemaResponse{}, resp, helpers.MustMarshal(t, resp)) {
					lastCreatedID = resp.(*api.CreateSchemaResponse).ID
				}
			}

			resp, err := client.ListSchemas(
				t.Context(),
				api.ListSchemasParams{
					ProjectID:  api.ProjectID(project.ID),
					ObjectType: api.OptString{Value: tc.objectType, Set: true},
				},
			)
			require.NoError(t, err)
			if assert.IsType(t, &api.ListSchemasResponse{}, resp, helpers.MustMarshal(t, resp)) {
				list := *(resp.(*api.ListSchemasResponse))
				// ensure all revisions are present
				assert.Len(t, list, len(tc.schemaRevisions))

				// ensure list endpoint is LIFO and latest items match
				assert.Equal(t, list[0].ID, lastCreatedID)
			}
		})
	}
}

// A schema created through the posted-body path records the `kind` its document
// declares, and listing by that kind returns it. The exclusion half of the
// contract — a different kind, and a row stored with no kind at all — is proven
// in stmttest, where a schema can be written directly; the API cannot produce
// either, because `kind` is an enum of one and the create path always populates
// it.
func TestSchemaKindFilter(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	objectType := "kind-filter-" + strings.ToLower(helpers.ProjectName())
	sch := api.UserSchema{}
	require.NoError(t, sch.UnmarshalJSON([]byte(fmt.Sprintf(
		`{
          "title": "kind filter",
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
        }`, objectType, helpers.BuiltinSchemaBaseURL))))

	created, err := client.CreateSchema(
		t.Context(),
		api.CreateSchemaReq{Type: api.UserSchemaCreateSchemaReq, UserSchema: sch},
		api.CreateSchemaParams{ProjectID: api.ProjectID(project.ID)},
	)
	require.NoError(t, err)
	require.IsType(t, &api.CreateSchemaResponse{}, created, helpers.MustMarshal(t, created))
	createdID := created.(*api.CreateSchemaResponse).ID

	list := func(t *testing.T, params api.ListSchemasParams) api.ListSchemasResponse {
		t.Helper()
		resp, err := client.ListSchemas(t.Context(), params)
		require.NoError(t, err)
		require.IsType(t, &api.ListSchemasResponse{}, resp, helpers.MustMarshal(t, resp))
		return *(resp.(*api.ListSchemasResponse))
	}

	base := api.ListSchemasParams{
		ProjectID:  api.ProjectID(project.ID),
		ObjectType: api.OptString{Value: objectType, Set: true},
	}

	withKind := base
	withKind.Kind = api.OptListSchemasKind{Value: api.ListSchemasKindUserSchema, Set: true}

	filtered := list(t, withKind)
	require.Len(t, filtered, 1)
	assert.Equal(t, createdID, filtered[0].ID)

	// The kind filter neither drops the schema nor adds anything to it: the same
	// query without a kind returns the same single row.
	assert.Len(t, list(t, base), 1)
}
