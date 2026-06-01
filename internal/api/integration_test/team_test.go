//go:build integration || spanner_integration

package integration_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/service"
)

func TestCreateTeam(t *testing.T) {

	t.Run("ok", func(t *testing.T) {
		project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
		require.NoError(t, err)

		req := &api.CreateTeamRequest{}
		params := api.CreateTeamParams{
			ProjectID: api.ProjectID(project.ID),
		}

		resp, err := harness.EnsureAPIClient(t, project.ID).CreateTeam(t.Context(), req, params)
		require.NoError(t, err)

		assert.IsType(t, &api.CreateTeamResponse{}, resp, mustMarshal(t, resp))
	})

	t.Run("error", func(t *testing.T) {
		t.Run("no project", func(t *testing.T) {
			req := &api.CreateTeamRequest{}
			params := api.CreateTeamParams{}

			resp, err := harness.EnsureAPIClient(t, "").CreateTeam(t.Context(), req, params)
			require.NoError(t, err)

			assert.IsType(t, &api.CreateTeamBadRequest{}, resp, mustMarshal(t, resp))
		})
	})
}

func TestGetTeam(t *testing.T) {
	t.Run("ok", func(t *testing.T) {
		project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
		require.NoError(t, err)
		team, err := harness.EnsureTeamService(t).CreateTeam(t.Context(), service.CreateTeamInput{
			ProjectID: project.ID,
		})
		require.NoError(t, err)

		params := api.GetTeamParams{
			ProjectID: api.ProjectID(project.ID),
			TeamID:    api.TeamID(team.ID),
		}

		resp, err := harness.EnsureAPIClient(t, project.ID).GetTeam(t.Context(), params)
		require.NoError(t, err)

		assert.IsType(t, &api.GetTeamResponse{}, resp, mustMarshal(t, resp))
	})

	t.Run("error", func(t *testing.T) {
		t.Run("non existing team", func(t *testing.T) {
			project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
			require.NoError(t, err)

			params := api.GetTeamParams{
				ProjectID: api.ProjectID(project.ID),
				TeamID:    api.TeamID("does-not-exist"),
			}

			resp, err := harness.EnsureAPIClient(t, project.ID).GetTeam(t.Context(), params)
			require.NoError(t, err)

			assert.IsType(t, &api.GetTeamNotFound{}, resp, mustMarshal(t, resp))
		})
	})
}
