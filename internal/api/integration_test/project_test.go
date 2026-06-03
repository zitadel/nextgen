//go:build postgres_integration || spanner_integration

package integration_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
)

func TestCreateProject(t *testing.T) {
	t.Run("ok", func(t *testing.T) {
		tcs := []struct {
			name string
			req  *api.CreateProjectRequest
		}{
			{
				name: "no optional fields",
				req: &api.CreateProjectRequest{
					PreviewOrigins: make([]string, 0),
				},
			},
			{
				name: "with optional fields",
				req: &api.CreateProjectRequest{
					PreviewOrigins: []string{"*.vercel.app", "*.netlify.app"},
				},
			},
		}

		for _, tc := range tcs {
			t.Run(tc.name, func(t *testing.T) {
				client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
				require.NoError(t, err)

				resp, err := client.CreateProject(t.Context(), tc.req)

				assert.NoError(t, err)
				if (assert.IsType(t, &api.CreateProjectResponse{}, resp, helpers.MustMarshal(t, resp))) {
					got := resp.(*api.CreateProjectResponse)
					assert.NotEmpty(t, got.ID)
					assert.NotEmpty(t, got.ProjectSecret)
					assert.NotEmpty(t, got.PreviewSecret)
					assert.Equal(t, tc.req.PreviewOrigins, got.PreviewOrigins)
				}
			})
		}
	})
}

func TestGetProject(t *testing.T) {
	project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	client.SetToken(project.ProjectSecret)

	t.Run("ok", func(t *testing.T) {
		params := api.GetProjectParams{
			ProjectID: api.ProjectID(project.ID),
		}

		resp, err := client.GetProject(t.Context(), params)

		assert.NoError(t, err)
		if assert.IsType(t, &api.GetProjectResponse{}, resp, helpers.MustMarshal(t, resp)) {
			got := resp.(*api.GetProjectResponse)
			assert.NotEmpty(t, got.CreatedAt)
			assert.NotEmpty(t, got.UpdatedAt)
			assert.Equal(t, project.ID, got.ID)
		}
	})

	t.Run("error", func(t *testing.T) {
		t.Run("not found", func(t *testing.T) {
			params := api.GetProjectParams{
				ProjectID: "does_not_exist",
			}

			resp, err := client.GetProject(t.Context(), params)

			assert.NoError(t, err)
			assert.IsType(t, &api.GetProjectNotFound{}, resp, helpers.MustMarshal(t, resp))
		})
	})
}
