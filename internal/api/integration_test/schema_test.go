//go:build integration

package integration_test

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/api/integration_test/test_data"
)

func TestCreateSchema(t *testing.T) {
	serv := harness.EnsureTestServer(t)
	project := harness.WithProject(t)

	t.Run("ok", func(t *testing.T) {
		testCases := []struct {
			name string
			req  []byte
		}{
			{
				name: "user-schema in body",
				req:  test_data.CreateSchemaRequestUserSchema,
			},
			{
				name: "user-schema by url",
				req:  test_data.CreateSchemaRequestUserSchemaByUrl,
			},
		}

		for _, tc := range testCases {
			uri := fmt.Sprintf("%s/schemas?project_id=%s", serv.URL, project.ID)
			req, err := http.NewRequest("POST", uri, bytes.NewReader(tc.req))
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
		}
	})
}
