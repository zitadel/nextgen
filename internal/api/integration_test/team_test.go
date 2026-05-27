//go:build integration

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
	client := harness.EnsureAPIClient(t)

	t.Run("ok", func(t *testing.T) {
		project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
		require.NoError(t, err)

		req := &api.CreateTeamRequest{}
		params := api.CreateTeamParams{
			ProjectID: api.OptProjectID{Set: true, Value: api.ProjectID(project.ID)},
		}

		resp, err := client.CreateTeam(t.Context(), req, params)
		require.NoError(t, err)

		if !assert.IsType(t, &api.CreateTeamResponse{}, resp) {
			helpers.LogInvalidResponse(t, resp)
		}
	})

	t.Run("error", func(t *testing.T) {
		t.Run("no project", func(t *testing.T) {
			req := &api.CreateTeamRequest{}
			params := api.CreateTeamParams{}

			resp, err := client.CreateTeam(t.Context(), req, params)
			require.NoError(t, err)

			if !assert.IsType(t, &api.CreateTeamNotFound{}, resp) {
				helpers.LogInvalidResponse(t, resp)
			}
		})
	})
}

func TestGetTeam(t *testing.T) {
	client := harness.EnsureAPIClient(t)

	t.Run("ok", func(t *testing.T) {
		project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
		require.NoError(t, err)
		team, err := harness.EnsureTeamService(t).CreateTeam(t.Context(), service.CreateTeamInput{
			ProjectID: project.ID,
		})

		params := api.GetTeamParams{
			ProjectID: api.OptProjectID{Set: true, Value: api.ProjectID(project.ID)},
			TeamID:    api.TeamID(team.ID),
		}

		resp, err := client.GetTeam(t.Context(), params)
		require.NoError(t, err)

		if !assert.IsType(t, &api.GetTeamResponse{}, resp) {
			helpers.LogInvalidResponse(t, resp)
		}
	})

	t.Run("error", func(t *testing.T) {
		t.Run("non existing team", func(t *testing.T) {
			project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
			require.NoError(t, err)

			params := api.GetTeamParams{
				ProjectID: api.OptProjectID{Set: true, Value: api.ProjectID(project.ID)},
				TeamID:    api.TeamID("does-not-exist"),
			}

			resp, err := client.GetTeam(t.Context(), params)
			require.NoError(t, err)

			if !assert.IsType(t, &api.GetTeamNotFound{}, resp) {
				helpers.LogInvalidResponse(t, resp)
			}
		})
	})
}
