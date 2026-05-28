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

func TestCreateUser(t *testing.T) {
	client := harness.EnsureAPIClient(t)

	t.Run("ok", func(t *testing.T) {
		t.Run("simple", func(t *testing.T) {
			project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
			require.NoError(t, err)

			team, err := harness.EnsureTeamService(t).CreateTeam(t.Context(), service.CreateTeamInput{
				ProjectID: project.ID,
			})
			require.NoError(t, err)

			harness.CreateUserSchema(t, project.ID, harness.TestData.Schemas.CreateSchemaRequestUserSchema)
			userBs := []byte(harness.TestData.Users.CreateUserRequest)

			user := &api.User{}
			err = user.UnmarshalJSON(userBs)
			require.NoError(t, err)

			params := api.CreateUserParams{
				ProjectID: api.ProjectID(project.ID),
				TeamID:    api.OptTeamID{Set: true, Value: api.TeamID(team.ID)},
			}

			resp, err := client.CreateUser(t.Context(), user, params)
			assert.NoError(t, err)

			assert.IsType(t, &api.CreateUserResponse{}, resp, helpers.MustMarshal(t, resp))
		})
	})
}

func TestGetUser(t *testing.T) {
	client := harness.EnsureAPIClient(t)

	t.Run("ok", func(t *testing.T) {
		project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
		require.NoError(t, err)

		team, err := harness.EnsureTeamService(t).CreateTeam(t.Context(), service.CreateTeamInput{
			ProjectID: project.ID,
		})
		require.NoError(t, err)

		harness.CreateUserSchema(t, project.ID, harness.TestData.Schemas.CreateSchemaRequestUserSchema)
		userBs := []byte(harness.TestData.Users.CreateUserRequest)

		user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
			ProjectID: project.ID,
			TeamID:    &team.ID,
			SchemaUrl: "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml",
			User:      *helpers.MustUnmarshal[map[string]any](t, userBs),
		})

		params := api.GetUserByIDParams{
			ProjectID: api.ProjectID(project.ID),
			TeamID:    api.OptTeamID{Set: true, Value: api.TeamID(team.ID)},
			UserID:    api.UserID(user["id"].(string)),
		}

		resp, err := client.GetUserByID(t.Context(), params)
		assert.NoError(t, err)

		assert.IsType(t, &api.GetUserByIDOK{}, resp, helpers.MustMarshal(t, resp))
	})
}
