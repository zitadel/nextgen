//go:build postgres_integration || spanner_integration

// TODO: enable spanner tests once user repository supports it

package integration_test

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/api/integration_test/test_data"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func TestCreateUser(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
		Name:      helpers.TeamName(),
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
					"schema": test_data.UserSchemaURL,
					"attributes": map[string]any{
						"email":       "john.doe.withalloptionalproperties@example.com",
						"givenName":   "John",
						"familyName":  "Doe",
						"dateOfBirth": "1990-05-12",
						"password":    "my-strong-password",
					},
				}),
			},
			{
				name: "user with no optional properties",
				params: api.CreateUserParams{
					ProjectID: api.ProjectID(project.ID),
				},
				userjson: helpers.MustMarshal(t, map[string]any{
					"schema": test_data.UserSchemaURL,
					"attributes": map[string]any{
						"email":      "john.doe.withoutoptionalproperties@example.com",
						"givenName":  "John",
						"familyName": "Doe",
						"password":   "my-strong-password",
					},
				}),
			},
			{
				name: "user without team membership",
				params: api.CreateUserParams{
					ProjectID: api.ProjectID(project.ID),
				},
				userjson: helpers.MustMarshal(t, map[string]any{
					"schema": test_data.UserSchemaURL,
					"attributes": map[string]any{
						"email":      "john.doe.withoutteammembership@example.com",
						"givenName":  "John",
						"familyName": "Doe",
						"password":   "my-strong-password",
					},
				}),
			},
			{
				name: "user with team membership",
				params: api.CreateUserParams{
					ProjectID: api.ProjectID(project.ID),
					TeamID:    api.OptTeamID{Set: true, Value: api.TeamID(team.ID)},
				},
				userjson: helpers.MustMarshal(t, map[string]any{
					"schema": test_data.UserSchemaURL,
					"attributes": map[string]any{
						"email":      "john.doe.withteammembermship@example.com",
						"givenName":  "John",
						"familyName": "Doe",
						"password":   "my-strong-password",
					},
				}),
			},
			{
				name: "user with empty value for optional properties",
				params: api.CreateUserParams{
					ProjectID: api.ProjectID(project.ID),
				},
				userjson: helpers.MustMarshal(t, map[string]any{
					"schema": test_data.UserSchemaURL,
					"attributes": map[string]any{
						"email":       "john.doe.emptyvalueoptionalproperties@example.com",
						"password":    "my-strong-password",
						"name":        "",
						"phoneNumber": "",
					},
				}),
			},
		}
		for _, tc := range tcs {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()

				user := &api.CreateUserRequest{}
				err := user.UnmarshalJSON([]byte(tc.userjson))
				require.NoError(t, err)

				resp, err := client.CreateUser(t.Context(), user, tc.params)
				assert.NoError(t, err)

				assert.IsType(t, &api.User{}, resp, helpers.MustMarshal(t, resp))
			})
		}

		t.Run("attributes may use envelope names", func(t *testing.T) {
			t.Parallel()

			// The envelope and the schema-defined content are separate
			// namespaces, so a schema is free to declare `id` or `metadata`.
			// Neither collides with the server's own fields.
			user := &api.CreateUserRequest{}
			require.NoError(t, user.UnmarshalJSON([]byte(helpers.MustMarshal(t, map[string]any{
				"schema": test_data.UserSchemaURL,
				"attributes": map[string]any{
					"email":    "john.doe.envelopenames@example.com",
					"password": "my-strong-password",
					"id":       "the-schema-owns-this-one",
					"metadata": "so-is-this",
				},
			}))))

			resp, err := client.CreateUser(t.Context(), user, params)
			require.NoError(t, err)
			require.IsType(t, &api.User{}, resp, helpers.MustMarshal(t, resp))

			created := resp.(*api.User)
			assert.True(t, strings.HasPrefix(string(created.ID), "user_"),
				"the envelope id is the minted one, not the attribute")
			assert.Equal(t, "the-schema-owns-this-one", userProp(t, *created, "id"))
			assert.Equal(t, "so-is-this", userProp(t, *created, "metadata"))
			assert.Equal(t, api.UserMetadataStatusActive, created.Metadata.Status)
		})
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
						"schema": test_data.UserSchemaURL,
						"attributes": map[string]any{
							"givenName":  "John",
							"familyName": "Doe",
							"password":   "my-strong-password",
						},
					}),
				},
				{
					// A user is stored as its attribute rows, so an empty
					// document has nothing to write and the dialects refuse
					// it — this pins that the answer is 400 and not their
					// 500. Against this schema `required` reports it first;
					// the guard itself is pinned on an all-optional schema in
					// TestNewCreateUser_AttributesRequired.
					name: "empty attributes",
					userjson: helpers.MustMarshal(t, map[string]any{
						"schema":     test_data.UserSchemaURL,
						"attributes": map[string]any{},
					}),
				},
			}

			for _, tc := range tcs {
				t.Run(tc.name, func(t *testing.T) {
					t.Parallel()

					user := &api.CreateUserRequest{}
					err := user.UnmarshalJSON([]byte(tc.userjson))
					require.NoError(t, err)

					resp, err := client.CreateUser(t.Context(), user, params)
					assert.NoError(t, err)

					assert.IsType(t, &api.CreateUserBadRequest{}, resp, helpers.MustMarshal(t, resp))
				})
			}
		})

		t.Run("a caller-supplied id is refused", func(t *testing.T) {
			t.Parallel()

			// ADR 047 section 4: a create body must not carry a client-chosen
			// resource primary key. The request schema is closed, so the field
			// is refused rather than skipped — the generated client cannot
			// express it, hence the raw request.
			body := helpers.MustMarshal(t, map[string]any{
				"schema":     test_data.UserSchemaURL,
				"id":         "user_supplied_by_the_caller",
				"attributes": harness.EnsureTestData(t).Generator.GenerateUser(t, "testcreateuser.suppliedid@example.com"),
			})

			req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
				harness.EnsureTestServer(t).URL+"/users?project_id="+project.ID, strings.NewReader(body))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+harness.ProjectSecret(t, project))

			resp, err := harness.EnsureHttpClient(t).Do(req)
			require.NoError(t, err)
			defer resp.Body.Close()

			answer, err := io.ReadAll(resp.Body)
			require.NoError(t, err)

			assert.Equal(t, http.StatusBadRequest, resp.StatusCode, string(answer))
		})

		t.Run("duplicate mail address", func(t *testing.T) {
			t.Parallel()

			user := &api.CreateUserRequest{}
			err := user.UnmarshalJSON([]byte(helpers.MustMarshal(t, map[string]any{
				"schema":     test_data.UserSchemaURL,
				"attributes": harness.EnsureTestData(t).Generator.GenerateUser(t, "testcreateuser.error.duplicatemailaddress@example.com"),
			})))
			require.NoError(t, err)

			resp, err := client.CreateUser(t.Context(), user, params)
			require.NoError(t, err)
			require.IsType(t, &api.User{}, resp, helpers.MustMarshal(t, resp))

			resp, err = client.CreateUser(t.Context(), user, params)
			assert.NoError(t, err)
			assert.IsType(t, &api.CreateUserConflict{}, resp, helpers.MustMarshal(t, resp))
		})
	})
}

func TestDeleteUser(t *testing.T) {
	t.Parallel()

	// ARRANGE
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		t.Run("simple delete", func(t *testing.T) {
			t.Parallel()

			user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
				ProjectID:  project.ID,
				SchemaURL:  test_data.UserSchemaURL,
				Attributes: harness.EnsureTestData(t).Generator.GenerateUser(t, "testdeleteuser@example.com"),
			})
			require.NoError(t, err)

			// ACT
			deleteParams := api.DeleteUserByIDParams{
				UserID: api.UserID(user.ID),
			}
			deleteResp, err := client.DeleteUserByID(t.Context(), deleteParams)
			require.NoError(t, err)

			// ASSERT
			assert.IsType(t, &api.DeleteUserByIDNoContent{}, deleteResp, helpers.MustMarshal(t, deleteResp))

			getUserParams := api.GetUserByIDParams{
				UserID: api.UserID(user.ID),
			}
			getResp, err := client.GetUserByID(t.Context(), getUserParams)
			require.NoError(t, err)

			assert.IsType(t, &api.GetUserByIDNotFound{}, getResp, helpers.MustMarshal(t, getResp))
		})

		t.Run("unknown user should not return 404", func(t *testing.T) {
			t.Parallel()

			// ACT
			deleteParams := api.DeleteUserByIDParams{
				UserID: api.UserID("user_idwhichdoesnotexist"),
			}
			deleteResp, err := client.DeleteUserByID(t.Context(), deleteParams)
			require.NoError(t, err)

			// ASSERT
			assert.IsType(t, &api.DeleteUserByIDNoContent{}, deleteResp, helpers.MustMarshal(t, deleteResp))
		})

		t.Run("delete user with active session", func(t *testing.T) {
			t.Parallel()

			const email = "testdeleteuserwithsession@example.com"
			const password = "pass123$"

			userService := harness.EnsureUserService(t)

			user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
				ProjectID:  project.ID,
				SchemaURL:  test_data.UserSchemaURL,
				Attributes: harness.EnsureTestData(t).Generator.GenerateUser(t, email),
			})
			require.NoError(t, err)
			userID := user.ID

			err = userService.SetPassword(t.Context(), service.SetPasswordInput{
				ProjectID: project.ID,
				UserID:    userID,
				Password:  password,
			})
			require.NoError(t, err)

			_, err = helpers.CreateSessionUsingPassword(t,
				harness.EnsureAuthAttemptService(t),
				harness.EnsureSessionService(t),
				project.ID, email, password,
			)
			require.NoError(t, err)

			// ACT
			deleteParams := api.DeleteUserByIDParams{
				UserID: api.UserID(userID),
			}
			deleteResp, err := client.DeleteUserByID(t.Context(), deleteParams)
			require.NoError(t, err)

			// ASSERT
			assert.IsType(t, &api.DeleteUserByIDNoContent{}, deleteResp, helpers.MustMarshal(t, deleteResp))

			getUserParams := api.GetUserByIDParams{
				UserID: api.UserID(userID),
			}
			getResp, err := client.GetUserByID(t.Context(), getUserParams)
			require.NoError(t, err)

			assert.IsType(t, &api.GetUserByIDNotFound{}, getResp, helpers.MustMarshal(t, getResp))
		})
	})
}

func TestSetUserPassword(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	// Each subtest gets its own user: the subtests run in parallel and the
	// password upsert is last-writer-wins on (project_id, user_id), so with a
	// shared user a sibling's SetUserPassword can land between this subtest's
	// write and its proof check and reject the proof.
	createUser := func(t *testing.T, email string) (api.SetUserPasswordParams, string) {
		t.Helper()
		user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
			ProjectID:  project.ID,
			SchemaURL:  test_data.UserSchemaURL,
			Attributes: harness.EnsureTestData(t).Generator.GenerateUser(t, email),
		})
		require.NoError(t, err)
		return api.SetUserPasswordParams{
			UserID: api.UserID(user.ID),
		}, user.StringAttribute("email")
	}

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		t.Run("create initial password", func(t *testing.T) {
			t.Parallel()

			params, userEmail := createUser(t, "testsetuserpassword.initial@example.com")

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

			params, userEmail := createUser(t, "testsetuserpassword.update@example.com")

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

			// A fresh project guarantees the user id cannot exist; the call
			// must carry that project's own secret now that the management
			// API binds every operation to the token's project.
			project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
			require.NoError(t, err)

			projClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
			require.NoError(t, err)
			harness.SetProjectSecretOnApiClient(t, projClient, project)

			request := &api.SetUserPasswordRequest{
				Password: "fake-password",
			}
			params := api.SetUserPasswordParams{
				UserID: api.UserID("user_does-not-exist"),
			}

			resp, err := projClient.SetUserPassword(t.Context(), request, params)
			assert.NoError(t, err)

			assert.IsType(t, &api.SetUserPasswordNotFound{}, resp, helpers.MustMarshal(t, resp))
		})
	})
}

func TestGetUser(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
		ProjectID:  project.ID,
		SchemaURL:  test_data.UserSchemaURL,
		Attributes: harness.EnsureTestData(t).Generator.GenerateUser(t, "testgetuser@example.com"),
	})
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	params := api.GetUserByIDParams{
		UserID: api.UserID(user.ID),
	}

	resp, err := client.GetUserByID(t.Context(), params)
	assert.NoError(t, err)

	require.IsType(t, &api.User{}, resp, helpers.MustMarshal(t, resp))

	// The roster lives at /users/{user_id}/teams; the user itself only reports
	// who owns its lifecycle, and this one is self-owned.
	assert.True(t, resp.(*api.User).Metadata.LifecycleOwnerTeamID.Null)
}

// TestListUserTeams pins the roster endpoint and the line ADR 024 draws: the
// roster (`GET /users/{user_id}/teams`, N:N, paginated) and lifecycle ownership
// (`metadata.lifecycleOwnerTeamId`, at most one team) are different answers and
// need not agree.
func TestListUserTeams(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	teams := harness.EnsureTeamService(t)
	unique := helpers.RandString(8)
	owner, err := teams.Create(t.Context(), service.CreateTeamInput{ProjectID: project.ID, Name: helpers.TeamName()})
	require.NoError(t, err)
	alpha, err := teams.Create(t.Context(), service.CreateTeamInput{ProjectID: project.ID, Name: "a-roster-" + unique})
	require.NoError(t, err)
	beta, err := teams.Create(t.Context(), service.CreateTeamInput{ProjectID: project.ID, Name: "b-roster-" + unique})
	require.NoError(t, err)

	schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)
	users := harness.EnsureUserFixture(t)
	emailAttr, err := domain.NewCreateAttribute("email", "roster@example.com", domain.AttributeUniquenessProject)
	require.NoError(t, err)
	require.NoError(t, users.Create(t.Context(), &domain.CreateUser{
		ProjectID:               project.ID,
		SchemaURL:               schemaURL,
		ID:                      "user_roster-01",
		LifecycleOwnerTeamID:    &owner.ID,
		InitialMembershipTeamID: &alpha.ID,
		Attributes:              domain.CreateAttributes{*emailAttr},
	}))
	require.NoError(t, harness.EnsureTeamMembershipFixture(t).Create(t.Context(), &domain.TeamMembership{
		ProjectID: project.ID,
		TeamID:    beta.ID,
		UserID:    "user_roster-01",
		Status:    domain.MembershipStatusPending,
	}))

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	listTeams := func(t *testing.T, params api.ListUserTeamsParams) *api.ListUserTeamsResponse {
		t.Helper()
		res, err := client.ListUserTeams(t.Context(), params)
		require.NoError(t, err)
		require.IsType(t, &api.ListUserTeamsResponse{}, res, helpers.MustMarshal(t, res))
		return res.(*api.ListUserTeamsResponse)
	}
	rosterParams := api.ListUserTeamsParams{
		UserID: api.UserID("user_roster-01"),
	}

	// The whole roster, ordered by team name, each entry naming its team.
	roster := listTeams(t, rosterParams)
	require.Len(t, roster.Teams, 2)
	assert.False(t, roster.NextPageToken.IsSet(), "the whole roster fits in one page")

	assert.Equal(t, alpha.ID, roster.Teams[0].ID)
	assert.Equal(t, alpha.Name, roster.Teams[0].Name, "the team name travels with the entry")
	assert.Equal(t, api.UserTeamMembershipStatusActive, roster.Teams[0].MembershipStatus)
	assert.False(t, roster.Teams[0].CreatedAt.IsZero())

	assert.Equal(t, beta.ID, roster.Teams[1].ID)
	assert.Equal(t, beta.Name, roster.Teams[1].Name)
	assert.Equal(t, api.UserTeamMembershipStatusPending, roster.Teams[1].MembershipStatus,
		"a pending invite is on the roster and says so")

	// The window walks the roster one page at a time, in the same order.
	page := listTeams(t, api.ListUserTeamsParams{
		UserID: rosterParams.UserID,
		Limit:  api.NewOptLimit(1),
	})
	require.Len(t, page.Teams, 1)
	assert.Equal(t, alpha.ID, page.Teams[0].ID)
	pageToken, ok := page.NextPageToken.Get()
	require.True(t, ok, "a full page carries a cursor")

	page = listTeams(t, api.ListUserTeamsParams{
		UserID:    rosterParams.UserID,
		Limit:     api.NewOptLimit(1),
		PageToken: api.NewOptPageToken(pageToken),
	})
	require.Len(t, page.Teams, 1)
	assert.Equal(t, beta.ID, page.Teams[0].ID)

	// The user endpoint answers the other question, and answers it differently.
	userResp, err := client.GetUserByID(t.Context(), api.GetUserByIDParams{
		UserID: rosterParams.UserID,
	})
	require.NoError(t, err)
	require.IsType(t, &api.User{}, userResp, helpers.MustMarshal(t, userResp))
	assert.Equal(t, api.NewOptNilString(owner.ID), userResp.(*api.User).Metadata.LifecycleOwnerTeamID,
		"the lifecycle owner is not one of the roster teams")

	// An unknown user is a 404, not an empty roster.
	missing, err := client.ListUserTeams(t.Context(), api.ListUserTeamsParams{
		UserID: api.UserID("user_does-not-exist"),
	})
	require.NoError(t, err)
	assert.IsType(t, &api.ListUserTeamsNotFound{}, missing, helpers.MustMarshal(t, missing))
}

func TestGetMyUser(t *testing.T) {
	t.Parallel()

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)

		// CREATE USER

		userService := harness.EnsureUserService(t)

		user, err := userService.CreateUser(t.Context(), service.CreateUserInput{
			ProjectID:  project.ID,
			SchemaURL:  test_data.UserSchemaURL,
			Attributes: harness.EnsureTestData(t).Generator.GenerateUser(t, "testgetuser@example.com"),
		})
		require.NoError(t, err)
		userID := user.ID
		userEmail := user.StringAttribute("email")

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
		tokenCrypter, err := keyService.GetProjectCrypter(t.Context(), project.ID, domain.EncryptionKeyPurposeToken)
		require.NoError(t, err)
		sessionToken, err := session.Token(tokenCrypter)
		require.NoError(t, err)

		// GET USER USING TOKEN

		client.SetSessionToken(sessionToken)
		resp, err := client.GetMyUser(t.Context())
		assert.NoError(t, err)

		assert.IsType(t, &api.User{}, resp, helpers.MustMarshal(t, resp))
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

		// Only the client-facing code and message are pinned: these tests run
		// with api.FullErrorInResponse on, which attaches the unwrapped cause
		// under `details` (never present in production responses).
		var answer struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		require.NoError(t, json.Unmarshal(body, &answer))
		assert.Equal(t, "auth.unauthorized", answer.Code)
		assert.Equal(t, "Missing or invalid session token.", answer.Message)
	})
}

func TestListPasskeys(t *testing.T) {
	t.Parallel()

	dependencies := func(t *testing.T) (project *domain.Project, user *domain.User, client *helpers.ApiClient) {
		project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)

		user, err = harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
			ProjectID:  project.ID,
			SchemaURL:  test_data.UserSchemaURL,
			Attributes: harness.EnsureTestData(t).Generator.GenerateUser(t, "testgetuser@example.com"),
		})
		require.NoError(t, err)

		client, err = helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, client, project)

		return project, user, client
	}

	t.Run("ok", func(t *testing.T) {
		t.Run("lists registered passkeys", func(t *testing.T) {
			t.Parallel()

			project, user, client := dependencies(t)

			userID := user.ID
			harness.RegisterPasskey(t, project.ID, userID, "first passkey")
			harness.RegisterPasskey(t, project.ID, userID, "second passkey")

			params := api.ListUserPasskeysParams{
				UserID: api.UserID(userID),
			}

			resp, err := client.ListUserPasskeys(t.Context(), params)
			require.NoError(t, err)

			if assert.IsType(t, &api.ListUserPasskeysResponse{}, resp, helpers.MustMarshal(t, resp)) {
				passkeys := resp.(*api.ListUserPasskeysResponse)
				require.Len(t, passkeys.Passkeys, 2)

				names := []string{passkeys.Passkeys[0].Name, passkeys.Passkeys[1].Name}
				assert.ElementsMatch(t, []string{"first passkey", "second passkey"}, names)

				for _, pk := range passkeys.Passkeys {
					assert.NotEmpty(t, pk.ID)
					assert.False(t, pk.CreatedAt.IsZero())
				}
			}
		})

		t.Run("empty passkeys", func(t *testing.T) {
			t.Parallel()

			_, user, client := dependencies(t)

			params := api.ListUserPasskeysParams{
				UserID: api.UserID(user.ID),
			}

			resp, err := client.ListUserPasskeys(t.Context(), params)
			require.NoError(t, err)

			if assert.IsType(t, &api.ListUserPasskeysResponse{}, resp, helpers.MustMarshal(t, resp)) {
				passkeys := resp.(*api.ListUserPasskeysResponse)
				require.Len(t, passkeys.Passkeys, 0)
			}
		})
	})

	t.Run("unknown user returns 404", func(t *testing.T) {
		t.Parallel()

		project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)

		client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, client, project)

		resp, err := client.ListUserPasskeys(t.Context(), api.ListUserPasskeysParams{
			UserID: "user_does_not_exist",
		})
		require.NoError(t, err)
		assert.IsType(t, &api.ListUserPasskeysNotFound{}, resp, helpers.MustMarshal(t, resp))
	})
}
