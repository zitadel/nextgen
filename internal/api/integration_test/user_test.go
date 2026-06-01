package integration_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/service"
)

func TestSetUserPassword(t *testing.T) {
	t.Run("ok", func(t *testing.T) {
		project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
		require.NoError(t, err)

		team, err := harness.EnsureTeamService(t).CreateTeam(t.Context(), service.CreateTeamInput{
			ProjectID: project.ID,
		})
		require.NoError(t, err)

		// TODO: user schema and flow definition should be created according to https://github.com/zitadel/nextgen/pull/183

		user := harness.TestData.Generator.GenerateUser(t)

		//user, err = harness.EnsureUserService(t).Create(ctx, service.CreateUserInput{
		//	ProjectID: project.ID,
		//	TeamID:    team.ID,
		//	User:      user,
		//})
		//require.NoError(t, err)

		client := harness.EnsureAPIClient(t, project.ID)

		request := &api.SetUserPasswordRequest{
			Password: "fake-password",
		}
		params := api.SetUserPasswordParams{
			ProjectID: api.ProjectID(project.ID),
			TeamID:    api.NewOptTeamID(api.TeamID(team.ID)),
			UserID:    api.UserID((user["id"]).(string)),
		}

		resp, err := client.SetUserPassword(t.Context(), request, params)
		assert.NoError(t, err)

		assert.IsType(t, &api.SetUserPasswordNoContent{}, resp)

	})

	t.Run("error", func(t *testing.T) {
		t.Run("user not found", func(t *testing.T) {
			project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
			require.NoError(t, err)

			team, err := harness.EnsureTeamService(t).CreateTeam(t.Context(), service.CreateTeamInput{
				ProjectID: project.ID,
			})
			require.NoError(t, err)

			client := harness.EnsureAPIClient(t, project.ID)

			request := &api.SetUserPasswordRequest{
				Password: "fake-password",
			}
			params := api.SetUserPasswordParams{
				ProjectID: api.ProjectID(project.ID),
				TeamID:    api.NewOptTeamID(api.TeamID(team.ID)),
				UserID:    api.UserID("does-not-exist"),
			}

			resp, err := client.SetUserPassword(t.Context(), request, params)
			assert.NoError(t, err)

			assert.IsType(t, &api.SetUserPasswordNotFound{}, resp)
		})
	})
}
