//go:build integration

package integration_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
)

func TestCreateSchema(t *testing.T) {
	serv := harness.EnsureTestServer(t)
	client := harness.EnsureAPIClient(t)

	t.Run("ok", func(t *testing.T) {
		testCases := []struct {
			name   string
			schema string
		}{
			{
				name:   "user-schema in body",
				schema: harness.Schemas.CreateSchemaRequestUserSchema,
			},
			//{
			//	name: "user-schema by url",
			//	req:  harness.Schemas.CreateSchemaRequestUserSchemaByUrl,
			//},
		}

		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				projectID := harness.CreateProject(t, "project_schema_create_ok"+strings.Replace(tc.name, " ", "_", -1))

				apiSchema := api.UserSchema{}
				err := apiSchema.UnmarshalJSON([]byte(tc.schema))
				require.NoError(t, err)

				req := api.CreateSchemaReq{
					Type:       api.UserSchemaCreateSchemaReq,
					UserSchema: apiSchema,
				}
				params := api.CreateSchemaParams{
					ProjectID: api.OptProjectID{Set: true, Value: api.ProjectID(projectID)},
				}

				resp, err := client.CreateSchema(t.Context(), req, params)
				assert.NoError(t, err)

				if !assert.IsType(t, &api.CreateSchemaResponse{}, resp) {
					bs, err := json.Marshal(resp)
					require.NoError(t, err)
					log.Println(string(bs))
				}
			})
		}
	})

	t.Run("error", func(t *testing.T) {
		t.Run("schema without known kind", func(t *testing.T) {
			projectID := harness.CreateProject(t, "project_schema_create_unknown_kind")

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

			uri := fmt.Sprintf("%s/schemas?project_id=%s", serv.URL, projectID)
			req, err := http.NewRequest("POST", uri, bytes.NewReader(body))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer this_is_a_fake_token__once_we_have_proper_auth__replace_this_with_a_proper_one") // TODO

			httpClient := harness.EnsureHttpClient(t)
			resp, err := httpClient.Do(req)
			assert.NoError(t, err)
			defer func() { _ = resp.Body.Close() }()

			if !assert.Equal(t, http.StatusBadRequest, resp.StatusCode) {
				bs, err := io.ReadAll(resp.Body)
				require.NoError(t, err)
				t.Fatal(string(bs))
			}
		})

		t.Run("duplicates are not allowed", func(t *testing.T) {
			client := harness.EnsureAPIClient(t)

			projectID := harness.CreateProject(t, "project_schema_create_duplicates")
			harness.CreateUserSchema(t, projectID, harness.Schemas.CreateSchemaRequestUserSchema)

			apiSchema := api.UserSchema{}
			err := apiSchema.UnmarshalJSON([]byte(harness.Schemas.CreateSchemaRequestUserSchema))
			require.NoError(t, err)

			req := api.CreateSchemaReq{
				Type:       api.UserSchemaCreateSchemaReq,
				UserSchema: apiSchema,
			}
			params := api.CreateSchemaParams{
				ProjectID: api.OptProjectID{Set: true, Value: api.ProjectID(projectID)},
			}

			resp, err := client.CreateSchema(t.Context(), req, params)
			assert.Error(t, err)
			_ = resp

			// TODO: return correct error
			// assert.NoError(t, err)
			//if !assert.IsType(t, &api.CreateSchemaConflict{}, resp) {
			//	bs, err := json.Marshal(resp)
			//	require.NoError(t, err)
			//	t.Fatal(string(bs))
			//}
		})
	})
}

func TestGetSchema(t *testing.T) {
	client := harness.EnsureAPIClient(t)

	t.Run("ok", func(t *testing.T) {
		t.Run("simple", func(t *testing.T) {
			projectID := harness.CreateProject(t, "project_schema_get_simple")
			schemaID := harness.CreateUserSchema(t, projectID, harness.Schemas.CreateSchemaRequestUserSchema)

			resp, err := client.GetSchemaById(t.Context(), api.GetSchemaByIdParams{
				ID:        schemaID,
				ProjectID: api.OptProjectID{Set: true, Value: api.ProjectID(projectID)},
			})

			assert.NoError(t, err)
			if !assert.IsType(t, &api.GetSchemaByIdOK{}, resp) {
				bs, err := json.Marshal(resp)
				require.NoError(t, err)
				log.Println(string(bs))
			}
		})
	})

	t.Run("error", func(t *testing.T) {
		t.Run("schema not found", func(t *testing.T) {
			projectID := harness.CreateProject(t, "project_schema_get_not_found")

			resp, err := client.GetSchemaById(t.Context(), api.GetSchemaByIdParams{
				ID:        "does-not-exist",
				ProjectID: api.OptProjectID{Set: true, Value: api.ProjectID(projectID)},
			})
			assert.Error(t, err)
			_ = resp

			// TODO: return correct error
			//assert.NoError(t, err)
			//if !assert.IsType(t, &api.GetSchemaByIdNotFound{}, resp) {
			//	bs, err := json.Marshal(resp)
			//	require.NoError(t, err)
			//	log.Println(string(bs))
			//}
		})
	})
}
