//go:build integration

package integration_test

import (
	"encoding/json"
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
)

func TestCreateUser(t *testing.T) {
	client := harness.EnsureAPIClient(t)

	t.Run("ok", func(t *testing.T) {
		t.Run("simple", func(t *testing.T) {
			projectID := harness.CreateProject(t, "project_user_create_ok_simple")
			teamID := harness.CreateTeam(t, projectID, "team_user_create_ok_simple")

			harness.CreateUserSchema(t, projectID, harness.TestData.Schemas.CreateSchemaRequestUserSchema)
			userBs := []byte(harness.TestData.Users.CreateUserRequest)

			user := api.User{}
			err := user.UnmarshalJSON(userBs)
			require.NoError(t, err)

			params := api.CreateUserParams{
				ProjectID: api.OptProjectID{Set: true, Value: api.ProjectID(projectID)},
				TeamID:    api.OptTeamID{Set: true, Value: api.TeamID(teamID)},
			}

			resp, err := client.CreateUser(t.Context(), user, params)
			assert.NoError(t, err)

			if !assert.IsType(t, &api.CreateUserResponse{}, resp) {
				bs, err := json.Marshal(resp)
				require.NoError(t, err)
				t.Log(string(bs))
			}
		})
	})

	t.Run("error", func(t *testing.T) {
		tcs := []struct {
			name                 string
			user                 api.User
			expectedResponseType api.CreateUserRes
		}{
			{
				name: "unknown schema",
				user: api.User{
					"$schema": jx.Raw("\"https://example.com/non-existing-schema.json\""),
				},
				expectedResponseType: &api.CreateUserBadRequest{},
			},
			{
				name: "missing schema",
				user: api.User{
					"firstName": jx.Raw("\"John\""),
					"lastName":  jx.Raw("\"Doe\""),
				},
				expectedResponseType: &api.CreateUserBadRequest{},
			},
			{
				name: "user does not comply with schema - missing property",
				user: api.User{
					"$schema":   jx.Raw("\"https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml\""),
					"firstName": jx.Raw("\"John\""),
					"lastName":  jx.Raw("\"Doe\""),
				},
				expectedResponseType: &api.CreateUserBadRequest{},
			},
		}

		for _, tc := range tcs {
			t.Run(tc.name, func(t *testing.T) {
				projectID := harness.CreateProject(t, "project_user_create_ok_simple")
				teamID := harness.CreateTeam(t, projectID, "team_user_create_ok_simple")

				params := api.CreateUserParams{
					ProjectID: api.OptProjectID{Set: true, Value: api.ProjectID(projectID)},
					TeamID:    api.OptTeamID{Set: true, Value: api.TeamID(teamID)},
				}

				resp, err := client.CreateUser(t.Context(), tc.user, params)
				assert.NoError(t, err)

				if !assert.IsType(t, tc.expectedResponseType, resp) {
					bs, err := json.Marshal(resp)
					require.NoError(t, err)
					t.Log(string(bs))
				}
			})
		}
	})
}
