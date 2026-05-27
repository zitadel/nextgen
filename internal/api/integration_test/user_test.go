//go:build integration

package integration_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestCreateUser(t *testing.T) {
	client := harness.EnsureAPIClient(t)

	t.Run("ok", func(t *testing.T) {
		t.Run("simple", func(t *testing.T) {
			project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
			require.NoError(t, err)

			// TODO create team
			var team *domain.Team

			harness.CreateUserSchema(t, project.ID, harness.TestData.Schemas.CreateSchemaRequestUserSchema)
			userBs := []byte(harness.TestData.Users.CreateUserRequest)

			user := &api.User{}
			err = user.UnmarshalJSON(userBs)
			require.NoError(t, err)

			params := api.CreateUserParams{
				ProjectID: api.OptProjectID{Set: true, Value: api.ProjectID(project.ID)},
				TeamID:    api.OptTeamID{Set: true, Value: api.TeamID(team.ID)},
			}

			resp, err := client.CreateUser(t.Context(), user, params)
			assert.NoError(t, err)

			if !assert.IsType(t, &api.CreateUserResponse{}, resp) {
				helpers.LogInvalidResponse(t, resp)
			}
		})
	})
}
