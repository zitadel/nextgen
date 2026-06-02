//go:build postgres_integration

// TODO: enable spanner tests once user repository supports it

package integration_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func TestCreateUser(t *testing.T) {
	project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
	require.NoError(t, err)

	team, err := harness.EnsureTeamService(t).CreateTeam(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
	})
	require.NoError(t, err)

	harness.CreateUserSchema(t, project.ID, harness.TestData.Schemas.CreateSchemaRequestUserSchema)

	client := harness.EnsureAPIClient(t, project.ID)

	params := api.CreateUserParams{
		ProjectID: api.ProjectID(project.ID),
		TeamID:    api.OptTeamID{Set: true, Value: api.TeamID(team.ID)},
	}

	t.Run("ok", func(t *testing.T) {
		tcs := []struct {
			name    string
			params  api.CreateUserParams
			usermap map[string]any
		}{
			{
				name: "user with all optional properties",
				params: api.CreateUserParams{
					ProjectID: api.ProjectID(project.ID),
				},
				usermap: map[string]any{
					"$schema":   "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml",
					"email":     "john.doe.withalloptionalproperties@example.com",
					"firstName": "john",
					"lastName":  "doe",
					"address": map[string]any{
						"street":      "Main Street",
						"houseNumber": "42a",
						"city":        "Lake town",
						"postalCode":  "6699",
						"country":     "Madeupia",
					},
				},
			},
			{
				name: "user with no optional properties",
				params: api.CreateUserParams{
					ProjectID: api.ProjectID(project.ID),
				},
				usermap: map[string]any{
					"$schema": "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml",
					"email":   "john.doe.withoutoptionalproperties@example.com",
				},
			},
			{
				name: "user without team membership",
				params: api.CreateUserParams{
					ProjectID: api.ProjectID(project.ID),
				},
				usermap: map[string]any{
					"$schema": "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml",
					"email":   "john.doe.withoutteammembership@example.com",
				},
			},
			{
				name: "user with team membership",
				params: api.CreateUserParams{
					ProjectID: api.ProjectID(project.ID),
					TeamID:    api.OptTeamID{Set: true, Value: api.TeamID(team.ID)},
				},
				usermap: map[string]any{
					"$schema": "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml",
					"email":   "john.doe.withteammembermship@example.com",
				},
			},
		}
		for _, tc := range tcs {
			t.Run(tc.name, func(t *testing.T) {
				userbs, err := json.Marshal(tc.usermap)
				require.NoError(t, err)

				user := &api.User{}
				err = user.UnmarshalJSON(userbs)
				require.NoError(t, err)

				resp, err := client.CreateUser(t.Context(), user, params)
				assert.NoError(t, err)

				assert.IsType(t, &api.CreateUserResponse{}, resp, helpers.MustMarshal(t, resp))
			})
		}
	})

	t.Run("error", func(t *testing.T) {
		t.Run("invalid user data according to schema", func(t *testing.T) {
			tcs := []struct {
				name    string
				usermap map[string]any
			}{
				{
					name: "missing required email property",
					usermap: map[string]any{
						"$schema":   "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml",
						"firstName": "john",
						"lastName":  "doe",
					},
				},
				{
					name: "first name too long",
					usermap: map[string]any{
						"$schema":   "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml",
						"email":     "john.withawaytolongname@example.com",
						"firstName": "john with a waaaaaaaaaaaaaaaaaaaaaaaaaaaaay too long name",
						"lastName":  "doe",
					},
				},
			}

			for _, tc := range tcs {
				userbs, err := json.Marshal(tc.usermap)
				require.NoError(t, err)

				user := &api.User{}
				err = user.UnmarshalJSON(userbs)
				require.NoError(t, err)

				resp, err := client.CreateUser(t.Context(), user, params)
				assert.NoError(t, err)

				assert.IsType(t, &api.CreateUserBadRequest{}, resp, helpers.MustMarshal(t, resp))
			}
		})

		t.Run("duplicate mail address", func(t *testing.T) {
			usermap := map[string]any{
				"$schema": "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml",
				"email":   "john.withaduplicatemailaddress@example.com",
			}

			userbs, err := json.Marshal(usermap)
			require.NoError(t, err)

			user := &api.User{}
			err = user.UnmarshalJSON(userbs)
			require.NoError(t, err)

			resp, err := client.CreateUser(t.Context(), user, params)
			require.NoError(t, err)
			require.IsType(t, &api.CreateUserResponse{}, resp, helpers.MustMarshal(t, resp))

			resp, err = client.CreateUser(t.Context(), user, params)
			assert.NoError(t, err)
			assert.IsType(t, &api.CreateUserConflict{}, resp, helpers.MustMarshal(t, resp))
		})
	})
}

func TestSetUserPassword(t *testing.T) {
	t.Run("ok", func(t *testing.T) {
		project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
		require.NoError(t, err)

		team, err := harness.EnsureTeamService(t).CreateTeam(t.Context(), service.CreateTeamInput{
			ProjectID: project.ID,
		})
		require.NoError(t, err)

		harness.CreateUserSchema(t, project.ID, harness.TestData.Schemas.CreateSchemaRequestUserSchema)

		// TODO: user schema and flow definition should be created according to https://github.com/zitadel/nextgen/pull/183

		usermap := harness.TestData.Generator.GenerateUser(t, "john.testsetuserpassword@example.com")

		user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
			ProjectID: project.ID,
			TeamID:    &team.ID,
			User:      usermap,
		})
		require.NoError(t, err)
		userID := user["id"].(string)
		userEmail := user["email"].(string)

		client := harness.EnsureAPIClient(t, project.ID)

		const password = "fake-password"
		request := &api.SetUserPasswordRequest{
			Password: password,
		}
		params := api.SetUserPasswordParams{
			ProjectID: api.ProjectID(project.ID),
			TeamID:    api.NewOptTeamID(api.TeamID(team.ID)),
			UserID:    api.UserID(userID),
		}

		resp, err := client.SetUserPassword(t.Context(), request, params)
		require.NoError(t, err)

		require.IsType(t, &api.SetUserPasswordNoContent{}, resp, helpers.MustMarshal(t, resp))

		authAttempts := harness.EnsureAuthAttemptService(t)
		attempt, err := authAttempts.Create(t.Context(), service.CreateAuthAttemptInput{
			ProjectID:      project.ID,
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser, domain.AuthCheckTypePassword},
		})
		require.NoError(t, err)

		attempt, err = authAttempts.IssueChallenge(t.Context(), service.IssueChallengeInput{
			ProjectID: project.ID,
			AttemptID: attempt.ID,
			Challenge: service.UserChallenge{},
		})
		require.NoError(t, err)
		userChallenge, ok := attempt.ChallengeByType(domain.AuthCheckTypeUser)
		require.True(t, ok)

		attempt, err = authAttempts.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   project.ID,
			AttemptID:   attempt.ID,
			ChallengeID: userChallenge.GetID(),
			Proof: service.UserProof{
				AttributeName: "email",
				LoginName:     userEmail,
			},
		})
		require.NoError(t, err)

		attempt, err = authAttempts.IssueChallenge(t.Context(), service.IssueChallengeInput{
			ProjectID: project.ID,
			AttemptID: attempt.ID,
			Challenge: service.PasswordChallenge{},
		})
		require.NoError(t, err)
		passwordChallenge, ok := attempt.ChallengeByType(domain.AuthCheckTypePassword)
		require.True(t, ok)

		attempt, err = authAttempts.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   project.ID,
			AttemptID:   attempt.ID,
			ChallengeID: passwordChallenge.GetID(),
			Proof:       service.PasswordProof{Password: password},
		})
		require.NoError(t, err)
		assert.True(t, attempt.IsCompleted())

		attempt, err = authAttempts.Handoff(t.Context(), service.HandoffInput{
			ProjectID: project.ID,
			AttemptID: attempt.ID,
		})
		require.NoError(t, err)
		require.NotNil(t, attempt.HandoffToken)

		session, err := harness.EnsureSessionService(t).Exchange(t.Context(), service.ExchangeInput{
			ProjectID:    project.ID,
			HandoffToken: attempt.HandoffToken.Plain(),
		})
		require.NoError(t, err)
		require.NotNil(t, session.UserID)
		assert.Equal(t, userID, *session.UserID)
		assert.Len(t, session.Factors, 2)

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
				UserID:    api.UserID("user_does-not-exist"),
			}

			resp, err := client.SetUserPassword(t.Context(), request, params)
			assert.NoError(t, err)

			assert.IsType(t, &api.SetUserPasswordNotFound{}, resp, helpers.MustMarshal(t, resp))
		})
	})
}

func TestGetUser(t *testing.T) {
	t.Run("ok", func(t *testing.T) {
		project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
		client := harness.EnsureAPIClient(t, project.ID)
		require.NoError(t, err)

		team, err := harness.EnsureTeamService(t).CreateTeam(t.Context(), service.CreateTeamInput{
			ProjectID: project.ID,
		})
		require.NoError(t, err)

		harness.CreateUserSchema(t, project.ID, harness.TestData.Schemas.CreateSchemaRequestUserSchema)

		user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
			ProjectID: project.ID,
			TeamID:    &team.ID,
			User:      harness.TestData.Generator.GenerateUser(t, "testgetuser@example.com"),
		})
		require.NoError(t, err)

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
