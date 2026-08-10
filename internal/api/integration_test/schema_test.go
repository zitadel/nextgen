//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"fmt"
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
						"enabled":  true,
						"position": 0,
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
                    "password": { "enabled": true, "position": 1 }
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

			schemaID := harness.CreateUserSchema(t, project, harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)

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
                    "password": { "enabled": true, "position": 1 }
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
                    "password": { "enabled": true, "position": 1 }
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
                    "password": { "enabled": true, "position": 0 }
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
