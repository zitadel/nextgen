//go:build postgres_integration

// TODO: enable spanner tests once user repository supports it

package integration_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func TestCreateUser(t *testing.T) {
	project, err := harness.EnsureProjectService(t).Create(t.Context(), nil, true)
	require.NoError(t, err)

	team, err := harness.EnsureTeamService(t).CreateTeam(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
	})
	require.NoError(t, err)

	client := harness.EnsureAPIClient(t, project.ID)

	params := api.CreateUserParams{
		ProjectID: api.ProjectID(project.ID),
		TeamID:    api.OptTeamID{Set: true, Value: api.TeamID(team.ID)},
	}

	t.Run("ok", func(t *testing.T) {
		tcs := []struct {
			name     string
			params   api.CreateUserParams
			userjson string
		}{
			{
				name: "user with all optional properties",
				params: api.CreateUserParams{
					ProjectID: api.ProjectID(project.ID),
				},
				userjson: helpers.MustMarshal(t, map[string]any{
					"$schema":     "https://test.example.schemas.com/schemas/default-human-user.json",
					"email":       "john.doe.withalloptionalproperties@example.com",
					"givenName":   "John",
					"familyName":  "Doe",
					"dateOfBirth": "1990-05-12",
					"password":    "my-strong-password",
				}),
			},
			{
				name: "user with no optional properties",
				params: api.CreateUserParams{
					ProjectID: api.ProjectID(project.ID),
				},
				userjson: helpers.MustMarshal(t, map[string]any{
					"$schema":    "https://test.example.schemas.com/schemas/default-human-user.json",
					"email":      "john.doe.withoutoptionalproperties@example.com",
					"givenName":  "John",
					"familyName": "Doe",
					"password":   "my-strong-password",
				}),
			},
			{
				name: "user without team membership",
				params: api.CreateUserParams{
					ProjectID: api.ProjectID(project.ID),
				},
				userjson: helpers.MustMarshal(t, map[string]any{
					"$schema":    "https://test.example.schemas.com/schemas/default-human-user.json",
					"email":      "john.doe.withoutteammembership@example.com",
					"givenName":  "John",
					"familyName": "Doe",
					"password":   "my-strong-password",
				}),
			},
			{
				name: "user with team membership",
				params: api.CreateUserParams{
					ProjectID: api.ProjectID(project.ID),
					TeamID:    api.OptTeamID{Set: true, Value: api.TeamID(team.ID)},
				},
				userjson: helpers.MustMarshal(t, map[string]any{
					"$schema":    "https://test.example.schemas.com/schemas/default-human-user.json",
					"email":      "john.doe.withteammembermship@example.com",
					"givenName":  "John",
					"familyName": "Doe",
					"password":   "my-strong-password",
				}),
			},
			{
				name: "user with empty value for optional properties",
				params: api.CreateUserParams{
					ProjectID: api.ProjectID(project.ID),
				},
				userjson: helpers.MustMarshal(t, map[string]any{
					"$schema":     "https://test.example.schemas.com/schemas/default-human-user.json",
					"email":       "john.doe.emptyvalueoptionalproperties@example.com",
					"password":    "my-strong-password",
					"name":        "",
					"phoneNumber": "",
				}),
			},
		}
		for _, tc := range tcs {
			t.Run(tc.name, func(t *testing.T) {
				user := &api.User{}
				err = user.UnmarshalJSON([]byte(tc.userjson))
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
				name     string
				userjson string
			}{
				{
					name: "missing required email property",
					userjson: helpers.MustMarshal(t, map[string]any{
						"$schema":    "https://test.example.schemas.com/schemas/default-human-user.json",
						"givenName":  "John",
						"familyName": "Doe",
						"password":   "my-strong-password",
					}),
				},
				{
					name: "given name too long",
					userjson: helpers.MustMarshal(t, map[string]any{
						"$schema":    "https://test.example.schemas.com/schemas/default-human-user.json",
						"email":      "john.withawaytolongname@example.com",
						"givenName":  "john doe with a waaaaaaaaaaaaaaaaaaaaaaaaaaaaay too long name",
						"familyName": "Doe",
						"password":   "my-strong-password",
					}),
				},
			}

			for _, tc := range tcs {
				user := &api.User{}
				err = user.UnmarshalJSON([]byte(tc.userjson))
				require.NoError(t, err)

				resp, err := client.CreateUser(t.Context(), user, params)
				assert.NoError(t, err)

				assert.IsType(t, &api.CreateUserBadRequest{}, resp, helpers.MustMarshal(t, resp))
			}
		})

		t.Run("duplicate mail address", func(t *testing.T) {
			usermap := harness.TestData.Generator.GenerateUser(t, "testcreateuser.error.duplicatemailaddress@example.com")

			user := &api.User{}
			err = user.UnmarshalJSON([]byte(helpers.MustMarshal(t, usermap)))
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
	project, err := harness.EnsureProjectService(t).Create(t.Context(), nil, true)
	require.NoError(t, err)

	user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
		ProjectID: project.ID,
		User:      harness.TestData.Generator.GenerateUser(t, "testsetuserpassword@example.com"),
	})
	require.NoError(t, err)
	userID := user["id"].(string)
	userEmail := user["email"].(string)

	params := api.SetUserPasswordParams{
		ProjectID: api.ProjectID(project.ID),
		UserID:    api.UserID(userID),
	}

	client := harness.EnsureAPIClient(t, project.ID)

	t.Run("ok", func(t *testing.T) {
		t.Run("create initial password", func(t *testing.T) {
			const password = "fake-password"
			request := &api.SetUserPasswordRequest{
				Password: password,
			}

			resp, err := client.SetUserPassword(t.Context(), request, params)
			assert.NoError(t, err)
			assert.IsType(t, &api.SetUserPasswordNoContent{}, resp, helpers.MustMarshal(t, resp))

			// ensure we can create a session using the credentials
			_, err = helpers.CreateSessionUsingPassword(t,
				harness.EnsureAuthAttemptService(t),
				harness.EnsureSessionService(t),
				project.ID, userEmail, password)
			assert.NoError(t, err)
		})

		t.Run("update password", func(t *testing.T) {
			const originalPassword = "fake-password"
			request := &api.SetUserPasswordRequest{
				Password: originalPassword,
			}

			resp, err := client.SetUserPassword(t.Context(), request, params)
			assert.NoError(t, err)
			assert.IsType(t, &api.SetUserPasswordNoContent{}, resp, helpers.MustMarshal(t, resp))

			const newPassword = "new-password"

			request = &api.SetUserPasswordRequest{
				Password: newPassword,
			}

			resp, err = client.SetUserPassword(t.Context(), request, params)
			assert.NoError(t, err)
			assert.IsType(t, &api.SetUserPasswordNoContent{}, resp, helpers.MustMarshal(t, resp))

			// ensure we can create a session using the new password
			_, err = helpers.CreateSessionUsingPassword(t,
				harness.EnsureAuthAttemptService(t),
				harness.EnsureSessionService(t),
				project.ID, userEmail, newPassword)
			assert.NoError(t, err)

			// ensure we cannot create a session using the original password
			_, err = helpers.CreateSessionUsingPassword(t,
				harness.EnsureAuthAttemptService(t),
				harness.EnsureSessionService(t),
				project.ID, userEmail, originalPassword)
			assert.ErrorAs(t, err, new(domain.ErrAuthAttemptProofRejected(nil)))
		})
	})

	t.Run("error", func(t *testing.T) {
		t.Run("user not found", func(t *testing.T) {
			project, err := harness.EnsureProjectService(t).Create(t.Context(), nil, true)
			require.NoError(t, err)

			client := harness.EnsureAPIClient(t, project.ID)

			request := &api.SetUserPasswordRequest{
				Password: "fake-password",
			}
			params := api.SetUserPasswordParams{
				ProjectID: api.ProjectID(project.ID),
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
		project, err := harness.EnsureProjectService(t).Create(t.Context(), nil, true)
		client := harness.EnsureAPIClient(t, project.ID)
		require.NoError(t, err)

		user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
			ProjectID: project.ID,
			User:      harness.TestData.Generator.GenerateUser(t, "testgetuser@example.com"),
		})
		require.NoError(t, err)

		params := api.GetUserByIDParams{
			ProjectID: api.ProjectID(project.ID),
			UserID:    api.UserID(user["id"].(string)),
		}

		resp, err := client.GetUserByID(t.Context(), params)
		assert.NoError(t, err)

		assert.IsType(t, &api.GetUserByIDOK{}, resp, helpers.MustMarshal(t, resp))
	})
}

func TestGetMyUser(t *testing.T) {
	t.Run("ok", func(t *testing.T) {
		project, err := harness.EnsureProjectService(t).Create(t.Context(), nil, true)
		client := harness.EnsureAPIClient(t, project.ID)
		require.NoError(t, err)

		// CREATE USER

		userService := harness.EnsureUserService(t)

		user, err := userService.CreateUser(t.Context(), service.CreateUserInput{
			ProjectID: project.ID,
			User:      harness.TestData.Generator.GenerateUser(t, "testgetuser@example.com"),
		})
		require.NoError(t, err)
		userID := user["id"].(string)
		userEmail := user["email"].(string)

		const password = "fake-password"
		err = userService.SetPassword(t.Context(), service.SetPasswordInput{
			ProjectID: project.ID,
			UserID:    userID,
			Password:  password,
		})
		require.NoError(t, err)

		// CREATE SESSION TOKEN

		session, err := helpers.CreateSessionUsingPassword(t,
			harness.EnsureAuthAttemptService(t),
			harness.EnsureSessionService(t),
			project.ID,
			userEmail,
			password,
		)
		require.NoError(t, err)

		sessionToken, err := session.Token(harness.EnsureCrypter(t))
		require.NoError(t, err)

		// GET USER USING TOKEN

		params := api.GetMyUserParams{
			NextgenSession: sessionToken,
		}
		resp, err := client.GetMyUser(t.Context(), params)
		assert.NoError(t, err)

		assert.IsType(t, &api.GetMyUserOK{}, resp, helpers.MustMarshal(t, resp))
	})
}
