//go:build postgres_integration || spanner_integration

package integration_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/service"
)

func TestCreateTeam(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	client.SetToken(project.ProjectSecret)

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		req := &api.CreateTeamRequest{}
		params := api.CreateTeamParams{
			ProjectID: api.ProjectID(project.ID),
		}

		resp, err := client.CreateTeam(t.Context(), req, params)
		require.NoError(t, err)

		assert.IsType(t, &api.CreateTeamResponse{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("error", func(t *testing.T) {
		t.Parallel()

		t.Run("no project", func(t *testing.T) {
			t.Parallel()

			req := &api.CreateTeamRequest{}
			params := api.CreateTeamParams{}

			resp, err := client.CreateTeam(t.Context(), req, params)
			require.NoError(t, err)

			assert.IsType(t, &api.CreateTeamBadRequest{}, resp, helpers.MustMarshal(t, resp))
		})
	})
}

func TestGetTeam(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	client.SetToken(project.ProjectSecret)

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		team, err := harness.EnsureTeamService(t).CreateTeam(t.Context(), service.CreateTeamInput{
			ProjectID: project.ID,
		})
		require.NoError(t, err)

		params := api.GetTeamParams{
			ProjectID: api.ProjectID(project.ID),
			TeamID:    api.TeamID(team.ID),
		}

		resp, err := client.GetTeam(t.Context(), params)
		require.NoError(t, err)

		assert.IsType(t, &api.GetTeamResponse{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("error", func(t *testing.T) {
		t.Parallel()

		t.Run("non existing team", func(t *testing.T) {
			t.Parallel()

			params := api.GetTeamParams{
				ProjectID: api.ProjectID(project.ID),
				TeamID:    api.TeamID("does-not-exist"),
			}

			resp, err := client.GetTeam(t.Context(), params)
			require.NoError(t, err)

			assert.IsType(t, &api.GetTeamNotFound{}, resp, helpers.MustMarshal(t, resp))
		})
	})
}
