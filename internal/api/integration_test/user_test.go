//go:build postgres_integration

// TODO: enable spanner tests once user repository supports it

package integration_test

import (
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func TestCreateUser(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), nil, true)
	require.NoError(t, err)

	team, err := harness.EnsureTeamService(t).CreateTeam(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
	})
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	params := api.CreateUserParams{
		ProjectID: api.ProjectID(project.ID),
		TeamID:    api.OptTeamID{Set: true, Value: api.TeamID(team.ID)},
	}

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

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
				t.Parallel()

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
		t.Parallel()

		t.Run("invalid user data according to schema", func(t *testing.T) {
			t.Parallel()

			tcs := []struct {
				name     string
				userjson string
			}{
				{
					// The email-only default schema still enforces `required`,
					// so a user missing email is rejected. (A value-constraint
					// case like maxLength lived on `givenName`, which the
					// minimal default no longer defines; that enforcement is
					// covered at the domain layer in
					// flow_field_validation_test.go.)
					name: "missing required email property",
					userjson: helpers.MustMarshal(t, map[string]any{
						"$schema":    "https://test.example.schemas.com/schemas/default-human-user.json",
						"givenName":  "John",
						"familyName": "Doe",
						"password":   "my-strong-password",
					}),
				},
			}

			for _, tc := range tcs {
				t.Run(tc.name, func(t *testing.T) {
					t.Parallel()

					user := &api.User{}
					err = user.UnmarshalJSON([]byte(tc.userjson))
					require.NoError(t, err)

					resp, err := client.CreateUser(t.Context(), user, params)
					assert.NoError(t, err)

					assert.IsType(t, &api.CreateUserBadRequest{}, resp, helpers.MustMarshal(t, resp))
				})
			}
		})

		t.Run("duplicate mail address", func(t *testing.T) {
			t.Parallel()

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
	t.Parallel()

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

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		t.Run("create initial password", func(t *testing.T) {
			t.Parallel()

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
			t.Parallel()

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
		t.Parallel()

		t.Run("user not found", func(t *testing.T) {
			t.Parallel()

			project, err := harness.EnsureProjectService(t).Create(t.Context(), nil, true)
			require.NoError(t, err)

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
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), nil, true)
	require.NoError(t, err)

	user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
		ProjectID: project.ID,
		User:      harness.TestData.Generator.GenerateUser(t, "testgetuser@example.com"),
	})
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	params := api.GetUserByIDParams{
		ProjectID: api.ProjectID(project.ID),
		UserID:    api.UserID(user["id"].(string)),
	}

	resp, err := client.GetUserByID(t.Context(), params)
	assert.NoError(t, err)

	assert.IsType(t, &api.GetUserByIDOK{}, resp, helpers.MustMarshal(t, resp))
}

func TestGetMyUser(t *testing.T) {
	t.Parallel()

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		project, err := harness.EnsureProjectService(t).Create(t.Context(), nil, true)
		require.NoError(t, err)
		client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
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

		keyService := harness.EnsureKeyService(t)
		projectDEK, err := keyService.GetProjectDEKCrypter(t.Context(), project.ID)
		require.NoError(t, err)
		sessionToken, err := session.Token(projectDEK)
		require.NoError(t, err)

		// GET USER USING TOKEN

		client.SetSessionToken(sessionToken)
		resp, err := client.GetMyUser(t.Context())
		assert.NoError(t, err)

		assert.IsType(t, &api.GetMyUserOK{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("missing session cookie", func(t *testing.T) {
		t.Parallel()

		// The generated client refuses to send an unauthenticated request, so
		// exercise the server's missing-credential path with a raw request.
		req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, harness.EnsureTestServer(t).URL+"/users/me", nil)
		require.NoError(t, err)

		resp, err := harness.EnsureHttpClient(t).Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		body, err := io.ReadAll(resp.Body)
		require.NoError(t, err)

		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
		assert.JSONEq(t,
			`{"code":"auth.unauthorized","message":"Missing or invalid session token."}`,
			string(body),
		)
	})
}
