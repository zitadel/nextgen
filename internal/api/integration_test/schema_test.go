//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
)

func TestCreateSchema(t *testing.T) {
	project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	client.SetToken(project.ProjectSecret)

	t.Run("ok", func(t *testing.T) {
		testCases := []struct {
			name   string
			schema string
		}{
			{
				name:   "user-schema in body",
				schema: harness.TestData.Schemas.CreateSchemaRequestUserSchema,
			},
			// TODO: add this test case once we have a public github-repo from which to get a schema
			//{
			//	name: "user-schema by url",
			//	req:  harness.Schemas.CreateSchemaRequestUserSchemaByUrl,
			//},
		}

		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				apiSchema := api.UserSchema{}
				err = apiSchema.UnmarshalJSON([]byte(tc.schema))
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
		t.Run("schema without known kind", func(t *testing.T) {
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
			project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
			require.NoError(t, err)
			harness.CreateUserSchema(t, project, harness.TestData.Schemas.CreateSchemaRequestUserSchema)

			apiSchema := api.UserSchema{}
			err = apiSchema.UnmarshalJSON([]byte(harness.TestData.Schemas.CreateSchemaRequestUserSchema))
			require.NoError(t, err)

			client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
			require.NoError(t, err)
			client.SetToken(project.ProjectSecret)

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
	project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	client.SetToken(project.ProjectSecret)

	t.Run("ok", func(t *testing.T) {
		t.Run("simple", func(t *testing.T) {
			schemaID := harness.CreateUserSchema(t, project, harness.TestData.Schemas.CreateSchemaRequestUserSchema)

			resp, err := client.GetSchemaById(t.Context(), api.GetSchemaByIdParams{
				ID:        schemaID,
				ProjectID: api.ProjectID(project.ID),
			})
			assert.NoError(t, err)

			assert.IsType(t, &api.GetSchemaByIdOK{}, resp, helpers.MustMarshal(t, resp))
		})
	})

	t.Run("error", func(t *testing.T) {
		t.Run("schema not found", func(t *testing.T) {
			resp, err := client.GetSchemaById(t.Context(), api.GetSchemaByIdParams{
				ID:        "does-not-exist",
				ProjectID: api.ProjectID(project.ID),
			})
			assert.NoError(t, err)

			assert.IsType(t, &api.GetSchemaByIdNotFound{}, resp, helpers.MustMarshal(t, resp))
		})
	})
}
