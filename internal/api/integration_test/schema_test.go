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
)

func TestCreateSchema(t *testing.T) {
	serv := harness.EnsureTestServer(t)
	project := harness.WithProject(t)

	t.Run("ok", func(t *testing.T) {
		testCases := []struct {
			name string
			req  string
		}{
			{
				name: "user-schema in body",
				req:  harness.Schemas.CreateSchemaRequestUserSchema,
			},
			//{
			//	name: "user-schema by url",
			//	req:  harness.Schemas.CreateSchemaRequestUserSchemaByUrl,
			//},
		}

		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				uri := fmt.Sprintf("%s/schemas?project_id=%s", serv.URL, project.ID)
				req, err := http.NewRequest("POST", uri, strings.NewReader(tc.req))
				require.NoError(t, err)
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Authorization", "Bearer this_is_a_fake_token__once_we_have_proper_auth__replace_this_with_a_proper_one") // TODO

				httpClient := harness.EnsureHttpClient(t)
				resp, err := httpClient.Do(req)
				assert.NoError(t, err)

				if !assert.Equal(t, http.StatusCreated, resp.StatusCode) {
					bs, err := io.ReadAll(resp.Body)
					require.NoError(t, err)
					log.Println(string(bs))
				}
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

			uri := fmt.Sprintf("%s/schemas?project_id=%s", serv.URL, project.ID)
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
	})
}
