//go:build postgres_integration || spanner_integration

// TODO: enable spanner tests once user repository supports it

package integration_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

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
			require.IsType(t, &api.CreateUserConflict{}, resp, helpers.MustMarshal(t, resp))
			conflict := resp.(*api.CreateUserConflict)
			assert.Equal(t, api.ErrorCode(domain.ErrUserAlreadyExists().Code), conflict.Code)
			assert.JSONEq(t, `{"fields":["attributes.email"]}`, string(conflict.Details.Value["details"]))
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

func TestGetUserPasswordState(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
		ProjectID:  project.ID,
		SchemaURL:  test_data.UserSchemaURL,
		Attributes: harness.EnsureTestData(t).Generator.GenerateUser(t, "testgetuserpassword@example.com"),
	})
	require.NoError(t, err)
	params := api.GetUserPasswordStateParams{UserID: api.UserID(user.ID)}
	setAt := func(t *testing.T) api.OptDateTime {
		t.Helper()
		resp, err := client.GetUserPasswordState(t.Context(), params)
		require.NoError(t, err)
		require.IsType(t, &api.UserPasswordState{}, resp, helpers.MustMarshal(t, resp))
		return resp.(*api.UserPasswordState).SetAt
	}
	assert.False(t, setAt(t).IsSet(), "a user without a password has no set_at")

	resp, err := client.SetUserPassword(t.Context(), &api.SetUserPasswordRequest{Password: "fake-password"},
		api.SetUserPasswordParams{UserID: params.UserID})
	require.NoError(t, err)
	require.IsType(t, &api.SetUserPasswordNoContent{}, resp, helpers.MustMarshal(t, resp))

	got := setAt(t)
	require.True(t, got.IsSet())
	// The database stamps it, on its own clock.
	assert.WithinDuration(t, time.Now(), got.Value, time.Minute)

	t.Run("unknown user", func(t *testing.T) {
		resp, err := client.GetUserPasswordState(t.Context(), api.GetUserPasswordStateParams{UserID: "user_unknown"})
		require.NoError(t, err)
		require.IsType(t, &api.GetUserPasswordStateNotFound{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("user.not_found"), resp.(*api.GetUserPasswordStateNotFound).Code)
	})
}

func TestSetUserPassword(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	deployDefaultTarget(t, project.ID)

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

		t.Run("64 characters", func(t *testing.T) {
			t.Parallel()

			params, userEmail := createUser(t, "testsetuserpassword.max@example.com")

			password := strings.Repeat("a", domain.MaxPasswordLength)
			resp, err := client.SetUserPassword(t.Context(), &api.SetUserPasswordRequest{Password: password}, params)
			assert.NoError(t, err)
			assert.IsType(t, &api.SetUserPasswordNoContent{}, resp, helpers.MustMarshal(t, resp))

			_, err = helpers.CreateSessionUsingPassword(t,
				harness.EnsureAuthAttemptService(t),
				harness.EnsureSessionService(t),
				project.ID, userEmail, password)
			assert.NoError(t, err)
		})

		t.Run("either composition of the same characters signs in", func(t *testing.T) {
			t.Parallel()

			params, userEmail := createUser(t, "testsetuserpassword.nfc@example.com")

			const (
				decomposed = "cafe\u0301-au-lait" // e + combining acute accent
				composed   = "caf\u00e9-au-lait"  // é as one code point
			)
			resp, err := client.SetUserPassword(t.Context(), &api.SetUserPasswordRequest{Password: decomposed}, params)
			assert.NoError(t, err)
			assert.IsType(t, &api.SetUserPasswordNoContent{}, resp, helpers.MustMarshal(t, resp))

			for _, typed := range []string{composed, decomposed} {
				_, err = helpers.CreateSessionUsingPassword(t,
					harness.EnsureAuthAttemptService(t),
					harness.EnsureSessionService(t),
					project.ID, userEmail, typed)
				assert.NoError(t, err, "%+q", typed)
			}
		})
	})

	t.Run("error", func(t *testing.T) {
		t.Parallel()

		badRequest := func(t *testing.T, password string, code string) {
			t.Helper()
			params, _ := createUser(t, "testsetuserpassword."+code+"@example.com")
			resp, err := client.SetUserPassword(t.Context(), &api.SetUserPasswordRequest{Password: password}, params)
			assert.NoError(t, err)
			require.IsType(t, &api.SetUserPasswordBadRequest{}, resp, helpers.MustMarshal(t, resp))
			assert.Equal(t, code, string(resp.(*api.SetUserPasswordBadRequest).Code))
		}

		t.Run("longer than 64 characters", func(t *testing.T) {
			t.Parallel()
			// The server's cap is reported in the password policy's shape,
			// as a max_length violation, whether or not a policy exists.
			params, _ := createUser(t, "testsetuserpassword.toolong@example.com")
			resp, err := client.SetUserPassword(t.Context(), &api.SetUserPasswordRequest{Password: strings.Repeat("a", domain.MaxPasswordLength+1)}, params)
			assert.NoError(t, err)
			require.IsType(t, &api.SetUserPasswordBadRequest{}, resp, helpers.MustMarshal(t, resp))
			body := resp.(*api.SetUserPasswordBadRequest)
			assert.Equal(t, domain.ErrUserPasswordPolicyViolation(nil).Code, string(body.Code))
			assert.JSONEq(t, `{"violations":{"max_length":64}}`, string(body.Details.Value["details"]))
		})

		t.Run("empty", func(t *testing.T) {
			t.Parallel()
			badRequest(t, "", domain.ErrUserPasswordEmpty().Code)
		})

		t.Run("more bytes than bcrypt takes", func(t *testing.T) {
			t.Parallel()
			// The harness hashes with bcrypt, which stops at 72 bytes: 64
			// code points pass the length rule but are 128 bytes here.
			params, _ := createUser(t, "testsetuserpassword.bcrypt@example.com")
			resp, err := client.SetUserPassword(t.Context(), &api.SetUserPasswordRequest{Password: strings.Repeat("ü", domain.MaxPasswordLength)}, params)
			assert.NoError(t, err)
			require.IsType(t, &api.SetUserPasswordBadRequest{}, resp, helpers.MustMarshal(t, resp))
			assert.Equal(t, domain.ErrUserPasswordTooLong().Code, string(resp.(*api.SetUserPasswordBadRequest).Code))
		})

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

func TestPatchUser(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	createUser := func(t *testing.T, email string) *domain.User {
		t.Helper()
		user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
			ProjectID:  project.ID,
			SchemaURL:  test_data.UserSchemaURL,
			Attributes: harness.EnsureTestData(t).Generator.GenerateUser(t, email),
		})
		require.NoError(t, err)
		return user
	}
	t.Run("ok", func(t *testing.T) {
		t.Parallel()
		user := createUser(t, "testpatchuser.ok@example.com")

		resp, err := client.PatchUserByID(t.Context(), patchUserRequest(t, map[string]any{
			"attributes": map[string]any{
				"email":    "testpatchuser.ok.patched@example.com",
				"nickname": "Patched",
			},
		}), api.PatchUserByIDParams{UserID: api.UserID(user.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.User{}, resp, helpers.MustMarshal(t, resp))

		patched := resp.(*api.User)
		assert.Equal(t, "testpatchuser.ok.patched@example.com", userProp(t, *patched, "email"))
		assert.Equal(t, "Patched", userProp(t, *patched, "nickname"))
	})

	t.Run("null deletes an attribute", func(t *testing.T) {
		t.Parallel()
		user := createUser(t, "testpatchuser.null@example.com")
		params := api.PatchUserByIDParams{UserID: api.UserID(user.ID)}

		resp, err := client.PatchUserByID(t.Context(), patchUserRequest(t, map[string]any{
			"attributes": map[string]any{"nickname": "Ephemeral"},
		}), params)
		require.NoError(t, err)
		require.IsType(t, &api.User{}, resp, helpers.MustMarshal(t, resp))

		resp, err = client.PatchUserByID(t.Context(), patchUserRequest(t, map[string]any{
			"attributes": map[string]any{"nickname": nil},
		}), params)
		require.NoError(t, err)
		require.IsType(t, &api.User{}, resp, helpers.MustMarshal(t, resp))
		_, stillThere := resp.(*api.User).Attributes["nickname"]
		assert.False(t, stillThere, "null deletes the attribute")
	})

	t.Run("merged result is validated against the schema", func(t *testing.T) {
		t.Parallel()
		user := createUser(t, "testpatchuser.invalid@example.com")

		resp, err := client.PatchUserByID(t.Context(), patchUserRequest(t, map[string]any{
			"attributes": map[string]any{"email": 5},
		}), api.PatchUserByIDParams{UserID: api.UserID(user.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.PatchUserByIDBadRequest{}, resp, helpers.MustMarshal(t, resp))
		// Answered like request validation: the field is named, its value is not.
		invalid := resp.(*api.PatchUserByIDBadRequest)
		assert.Equal(t, api.ErrorCode(domain.ErrRequestInvalid().Code), invalid.Code)
		assert.Equal(t, domain.ErrRequestInvalid().Message, invalid.Message)
		assert.JSONEq(t, `{"fields":["attributes.email"]}`, string(invalid.Details.Value["details"]))
	})

	t.Run("an unknown schema pointer is refused", func(t *testing.T) {
		t.Parallel()
		user := createUser(t, "testpatchuser.unknownschema@example.com")

		resp, err := client.PatchUserByID(t.Context(), patchUserRequest(t, map[string]any{
			"schema": "https://example.com/schemas/does-not-exist",
		}), api.PatchUserByIDParams{UserID: api.UserID(user.ID)})
		require.NoError(t, err)
		assert.IsType(t, &api.PatchUserByIDBadRequest{}, resp, helpers.MustMarshal(t, resp))
	})

	// Two revisions of one logical schema: v2 drops nickname and requires
	// country. Both are closed, so a value the target does not declare must be
	// removed by the patch.
	revisionSchema := func(revision string, properties, required string) string {
		return `{
			"title": "PatchRevisionsSchema",
			"metaSchema": "https://test.example.schemas.com/schemas/user-schema.json",
			"$id": "https://patch-revisions.example.com/schemas/` + revision + `.json",
			"kind": "user-schema",
			"objectType": "patch-revisions-user",
			"type": "object",
			"additionalProperties": false,
			"x-identifier": "email",
			"x-auth-methods": {"password": {"enabled": true}},
			"required": ` + required + `,
			"properties": {
				"email": {"type": "string", "format": "email", "x-unique": "project"},
				` + properties + `
			}
		}`
	}
	revisionV1 := harness.CreateUserSchema(t, project, revisionSchema("v1",
		`"nickname": {"type": "string"}`, `["email"]`))
	revisionV2 := harness.CreateUserSchema(t, project, revisionSchema("v2",
		`"country": {"type": "string"}`, `["email", "country"]`))

	createRevisionUser := func(t *testing.T, email string) *domain.User {
		t.Helper()
		user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
			ProjectID:  project.ID,
			SchemaURL:  revisionV1,
			Attributes: map[string]any{"email": email, "nickname": "Nick"},
		})
		require.NoError(t, err)
		return user
	}
	getUser := func(t *testing.T, userID string) *api.User {
		t.Helper()
		resp, err := client.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(userID)})
		require.NoError(t, err)
		require.IsType(t, &api.User{}, resp, helpers.MustMarshal(t, resp))
		return resp.(*api.User)
	}
	requireAttributesInvalid := func(t *testing.T, resp api.PatchUserByIDRes, wantFields string) {
		t.Helper()
		require.IsType(t, &api.PatchUserByIDBadRequest{}, resp, helpers.MustMarshal(t, resp))
		invalid := resp.(*api.PatchUserByIDBadRequest)
		assert.Equal(t, api.ErrorCode(domain.ErrRequestInvalid().Code), invalid.Code)
		assert.JSONEq(t, wantFields, string(invalid.Details.Value["details"]))
	}

	t.Run("an older revision is validated like a newer one", func(t *testing.T) {
		t.Parallel()
		user := createRevisionUser(t, "testpatchuser.olderrevision@example.com")
		params := api.PatchUserByIDParams{UserID: api.UserID(user.ID)}

		// Forward: v2 requires country and does not declare nickname.
		resp, err := client.PatchUserByID(t.Context(), patchUserRequest(t, map[string]any{
			"schema": revisionV2,
		}), params)
		require.NoError(t, err)
		requireAttributesInvalid(t, resp, `{"fields":["attributes.country","attributes.nickname"]}`)
		unchanged := getUser(t, user.ID)
		assert.Equal(t, revisionV1, unchanged.Schema)
		assert.Equal(t, "Nick", userProp(t, *unchanged, "nickname"))

		resp, err = client.PatchUserByID(t.Context(), patchUserRequest(t, map[string]any{
			"schema":     revisionV2,
			"attributes": map[string]any{"country": "CH", "nickname": nil},
		}), params)
		require.NoError(t, err)
		require.IsType(t, &api.User{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, revisionV2, resp.(*api.User).Schema)

		// Backward: v1 does not declare country, so the same validation
		// refuses keeping it, and the user is left unchanged.
		resp, err = client.PatchUserByID(t.Context(), patchUserRequest(t, map[string]any{
			"schema": revisionV1,
		}), params)
		require.NoError(t, err)
		requireAttributesInvalid(t, resp, `{"fields":["attributes.country"]}`)
		unchanged = getUser(t, user.ID)
		assert.Equal(t, revisionV2, unchanged.Schema)
		assert.Equal(t, "CH", userProp(t, *unchanged, "country"))

		resp, err = client.PatchUserByID(t.Context(), patchUserRequest(t, map[string]any{
			"schema":     revisionV1,
			"attributes": map[string]any{"country": nil},
		}), params)
		require.NoError(t, err)
		require.IsType(t, &api.User{}, resp, helpers.MustMarshal(t, resp))
		moved := resp.(*api.User)
		assert.Equal(t, revisionV1, moved.Schema)
		_, hasCountry := moved.Attributes["country"]
		assert.False(t, hasCountry)
		_, hasNickname := moved.Attributes["nickname"]
		assert.False(t, hasNickname, "v1 declares nickname, but the value removed by the forward move stays removed")
	})

	t.Run("duplicate mail address", func(t *testing.T) {
		t.Parallel()
		createUser(t, "testpatchuser.taken@example.com")
		userB := createUser(t, "testpatchuser.claimant@example.com")

		resp, err := client.PatchUserByID(t.Context(), patchUserRequest(t, map[string]any{
			"attributes": map[string]any{"email": "testpatchuser.taken@example.com"},
		}), api.PatchUserByIDParams{UserID: api.UserID(userB.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.PatchUserByIDConflict{}, resp, helpers.MustMarshal(t, resp))
		// The taken attribute is named, the user holding it is not.
		conflict := resp.(*api.PatchUserByIDConflict)
		assert.Equal(t, api.ErrorCode(domain.ErrUserAlreadyExists().Code), conflict.Code)
		assert.JSONEq(t, `{"fields":["attributes.email"]}`, string(conflict.Details.Value["details"]))
	})

	t.Run("unknown user", func(t *testing.T) {
		t.Parallel()

		resp, err := client.PatchUserByID(t.Context(), patchUserRequest(t, map[string]any{
			"attributes": map[string]any{"nickname": "Nobody"},
		}), api.PatchUserByIDParams{UserID: api.UserID("user_does-not-exist")})
		require.NoError(t, err)
		assert.IsType(t, &api.PatchUserByIDNotFound{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("empty patch is refused", func(t *testing.T) {
		t.Parallel()
		user := createUser(t, "testpatchuser.empty@example.com")

		// The request schema requires at least one property, so the generated
		// client cannot express an empty patch — raw request.
		req, err := http.NewRequestWithContext(t.Context(), http.MethodPatch,
			harness.EnsureTestServer(t).URL+"/users/"+user.ID, strings.NewReader(`{}`))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+harness.ProjectSecret(t, project))

		resp, err := harness.EnsureHttpClient(t).Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		require.NoError(t, err)
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode, string(body))
	})
}

// patchUserRequest builds a PATCH /users/{user_id} body from a plain map, so a
// test can send JSON null to delete an attribute.
func patchUserRequest(t *testing.T, body map[string]any) *api.PatchUserRequest {
	t.Helper()
	req := &api.PatchUserRequest{}
	require.NoError(t, req.UnmarshalJSON([]byte(helpers.MustMarshal(t, body))))
	return req
}

// TestPatchUserFailedMigration pins the guarantee #1507 makes: a patch that
// moves a user to another schema and fails changes neither the user's
// attributes nor its schema reference. Three of the failures are decided in
// Prepare, before the write transaction, so nothing is written for them; the
// unknown schema reference is kept to match #1659 one to one, its 400 is also
// covered by TestPatchUser. The unique collision is decided by the registry
// insert inside the transaction, after the old rows were already deleted, so
// it is the case that would leak a partial write.
func TestPatchUserFailedMigration(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	// Every revision shares the object type and declares the same uniqueness
	// rules, since #1507 rejects a migration that changes them. Each one
	// changes a single rule of the first: a property it requires, an enum, or
	// an optional property it adds.
	revision := func(t *testing.T, required []string, properties string) string {
		t.Helper()
		return harness.CreateUserSchema(t, project, fmt.Sprintf(`{
			"title": "MigrationUser",
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			"metaSchema": "%s/user-schema.json",
			"kind": "user-schema",
			"objectType": "migration-user",
			"type": "object",
			"x-auth-methods": {"passkey": {"enabled": true}},
			"required": %s,
			"properties": {
				"username": {"type": "string", "x-unique": "project"},
				"nickname": {"type": "string"},
				%s
			}
		}`, helpers.BuiltinSchemaBaseURL, helpers.MustMarshal(t, required), properties))
	}
	initialSchema := revision(t, []string{"username"}, `
		"color": {"type": "string"}`)
	requiresGivenName := revision(t, []string{"username", "givenName"}, `
		"color": {"type": "string"},
		"givenName": {"type": "string"}`)
	restrictsColor := revision(t, []string{"username"}, `
		"color": {"type": "string", "enum": ["red", "blue"]}`)
	addsLanguage := revision(t, []string{"username"}, `
		"color": {"type": "string"},
		"preferredLanguage": {"type": "string"}`)

	users := harness.EnsureUserService(t)
	createUser := func(t *testing.T, attributes map[string]any) (*domain.User, error) {
		t.Helper()
		return users.CreateUser(t.Context(), service.CreateUserInput{
			ProjectID:  project.ID,
			SchemaURL:  initialSchema,
			Attributes: attributes,
		})
	}

	// stored is what a failed migration must leave alone, read from storage
	// rather than from the response.
	type stored struct {
		schemaURL  string
		attributes map[string]any
		updatedAt  time.Time
	}
	readStored := func(t *testing.T, userID string) stored {
		t.Helper()
		user, err := users.GetUserByID(t.Context(), service.GetUserInput{ProjectID: project.ID, UserID: userID})
		require.NoError(t, err)
		attributes, err := user.Attributes.ToMap()
		require.NoError(t, err)
		return stored{
			schemaURL:  user.SchemaURL,
			attributes: attributes,
			updatedAt:  user.Metadata.UpdatedAt,
		}
	}

	for _, tc := range []struct {
		name         string
		targetSchema string
		// collide has another user claim a username first, and the patch
		// takes it over in the same request as the move.
		collide    bool
		wantStatus any
		wantCode   string
		// wantFields, when set, is the details.fields a schema failure names.
		wantFields string
	}{
		{
			name:         "a required attribute of the target revision is missing",
			targetSchema: requiresGivenName,
			wantStatus:   &api.PatchUserByIDBadRequest{},
			wantCode:     domain.ErrRequestInvalid().Code,
			wantFields:   `{"fields":["attributes.givenName"]}`,
		},
		{
			name:         "a value violates a tightened rule",
			targetSchema: restrictsColor,
			wantStatus:   &api.PatchUserByIDBadRequest{},
			wantCode:     domain.ErrRequestInvalid().Code,
			wantFields:   `{"fields":["attributes.color"]}`,
		},
		{
			name:         "a value collides with another user's unique attribute",
			targetSchema: addsLanguage,
			collide:      true,
			wantStatus:   &api.PatchUserByIDConflict{},
			wantCode:     domain.ErrUserAlreadyExists().Code,
		},
		{
			name:         "the target schema reference does not exist",
			targetSchema: "https://example.com/schemas/migration-user-does-not-exist",
			wantStatus:   &api.PatchUserByIDBadRequest{},
			wantCode:     domain.ErrUserInvalid().Code,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			suffix := helpers.RandString(8)
			taken := "holder-" + suffix
			if tc.collide {
				_, err := createUser(t, map[string]any{"username": taken})
				require.NoError(t, err)
			}
			username := "migrant-" + suffix
			user, err := createUser(t, map[string]any{
				"username": username,
				"nickname": "nick-" + suffix,
				"color":    "green",
			})
			require.NoError(t, err)
			before := readStored(t, user.ID)

			body := map[string]any{"schema": tc.targetSchema}
			if tc.collide {
				body["attributes"] = map[string]any{"username": taken, "preferredLanguage": "en"}
			}
			resp, err := client.PatchUserByID(t.Context(), patchUserRequest(t, body), api.PatchUserByIDParams{UserID: api.UserID(user.ID)})
			require.NoError(t, err)
			require.IsType(t, tc.wantStatus, resp, helpers.MustMarshal(t, resp))
			assertAuthzError(t, resp, tc.wantCode)
			if tc.wantFields != "" {
				assert.JSONEq(t, tc.wantFields, string(resp.(*api.PatchUserByIDBadRequest).Details.Value["details"]))
			}

			after := readStored(t, user.ID)
			assert.Equal(t, before.schemaURL, after.schemaURL, "schema reference")
			assert.Equal(t, before.attributes, after.attributes, "attributes")
			assert.True(t, before.updatedAt.Equal(after.updatedAt), "updated_at moved from %s to %s", before.updatedAt, after.updatedAt)

			// The unique attribute registry must still hold the original
			// username for this user, so a second user cannot take it.
			_, err = createUser(t, map[string]any{"username": username})
			assert.ErrorIs(t, err, domain.ErrUserAlreadyExists(), "the original username must still be claimed")
		})
	}
}

func TestPatchMyUser(t *testing.T) {
	t.Parallel()

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)

		userService := harness.EnsureUserService(t)
		user, err := userService.CreateUser(t.Context(), service.CreateUserInput{
			ProjectID:  project.ID,
			SchemaURL:  test_data.UserSchemaURL,
			Attributes: harness.EnsureTestData(t).Generator.GenerateUser(t, "testpatchmyuser@example.com"),
		})
		require.NoError(t, err)

		const password = "fake-password"
		require.NoError(t, userService.SetPassword(t.Context(), service.SetPasswordInput{
			ProjectID: project.ID,
			UserID:    user.ID,
			Password:  password,
		}))

		session, err := helpers.CreateSessionUsingPassword(t,
			harness.EnsureAuthAttemptService(t),
			harness.EnsureSessionService(t),
			project.ID,
			user.StringAttribute("email"),
			password,
		)
		require.NoError(t, err)
		tokenCrypter, err := harness.EnsureKeyService(t).GetProjectCrypter(t.Context(), project.ID, domain.EncryptionKeyPurposeToken)
		require.NoError(t, err)
		sessionToken, err := session.Token(tokenCrypter)
		require.NoError(t, err)
		client.SetSessionToken(sessionToken)

		patch := &api.PatchMyUserRequest{}
		require.NoError(t, patch.UnmarshalJSON([]byte(helpers.MustMarshal(t, map[string]any{
			"attributes": map[string]any{"nickname": "Myself"},
		}))))

		resp, err := client.PatchMyUser(t.Context(), patch, api.PatchMyUserParams{})
		require.NoError(t, err)
		require.IsType(t, &api.User{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, "Myself", userProp(t, *resp.(*api.User), "nickname"))
	})

	t.Run("missing session cookie", func(t *testing.T) {
		t.Parallel()

		// The generated client refuses to send an unauthenticated request, so
		// exercise the server's missing-credential path with a raw request.
		req, err := http.NewRequestWithContext(t.Context(), http.MethodPatch,
			harness.EnsureTestServer(t).URL+"/users/me", strings.NewReader(`{"attributes":{"nickname":"Nobody"}}`))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")

		resp, err := harness.EnsureHttpClient(t).Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		require.NoError(t, err)

		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
		var answer struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		require.NoError(t, json.Unmarshal(body, &answer))
		assert.Equal(t, "auth.unauthorized", answer.Code)
		assert.Equal(t, "Missing or invalid session token.", answer.Message)
	})
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
		resp, err := client.GetMyUser(t.Context(), api.GetMyUserParams{})
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

// TestMyUser_HoldsTheSessionToTheNamedProject pins project-bound calls on the
// session's user: with project_id, a live session of another project on the
// same server is refused with 403 sess.project_mismatch by the user read, its
// patch, its schema and the lists of its projects and teams alike, and the
// refused patch changes nothing. Its own project is served as before.
func TestMyUser_HoldsTheSessionToTheNamedProject(t *testing.T) {
	t.Parallel()

	projects := harness.EnsureProjectService(t)
	project, err := projects.Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	// Nothing is read from it: it only has to be a project the session does not
	// belong to.
	otherProject, err := projects.Create(t.Context(), helpers.ProjectName(), nil, false)
	require.NoError(t, err)

	userService := harness.EnsureUserService(t)
	user, err := userService.CreateUser(t.Context(), service.CreateUserInput{
		ProjectID:  project.ID,
		SchemaURL:  test_data.UserSchemaURL,
		Attributes: harness.EnsureTestData(t).Generator.GenerateUser(t, "testmyuserproject@example.com"),
	})
	require.NoError(t, err)
	const password = "fake-password"
	require.NoError(t, userService.SetPassword(t.Context(), service.SetPasswordInput{
		ProjectID: project.ID,
		UserID:    user.ID,
		Password:  password,
	}))
	session, err := helpers.CreateSessionUsingPassword(t,
		harness.EnsureAuthAttemptService(t),
		harness.EnsureSessionService(t),
		project.ID,
		user.StringAttribute("email"),
		password,
	)
	require.NoError(t, err)
	tokenCrypter, err := harness.EnsureKeyService(t).GetProjectCrypter(t.Context(), project.ID, domain.EncryptionKeyPurposeToken)
	require.NoError(t, err)
	sessionToken, err := session.Token(tokenCrypter)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	client.SetSessionToken(sessionToken)

	own := api.NewOptProjectID(api.ProjectID(project.ID))
	other := api.NewOptProjectID(api.ProjectID(otherProject.ID))
	nickname := func(value string) *api.PatchMyUserRequest {
		patch := &api.PatchMyUserRequest{}
		require.NoError(t, patch.UnmarshalJSON([]byte(helpers.MustMarshal(t, map[string]any{
			"attributes": map[string]any{"nickname": value},
		}))))
		return patch
	}

	read, err := client.GetMyUser(t.Context(), api.GetMyUserParams{ProjectID: other})
	require.NoError(t, err)
	require.IsType(t, &api.SessProjectMismatch{}, read, helpers.MustMarshal(t, read))
	assert.Equal(t, "sess.project_mismatch", read.(*api.SessProjectMismatch).Code)

	patched, err := client.PatchMyUser(t.Context(), nickname("Intruder"), api.PatchMyUserParams{ProjectID: other})
	require.NoError(t, err)
	require.IsType(t, &api.PatchMyUserForbidden{}, patched, helpers.MustMarshal(t, patched))
	assert.Equal(t, api.ErrorCode("sess.project_mismatch"), patched.(*api.PatchMyUserForbidden).Code)

	listed, err := client.ListMyProjects(t.Context(), api.ListMyProjectsParams{ProjectID: other})
	require.NoError(t, err)
	require.IsType(t, &api.SessProjectMismatch{}, listed, helpers.MustMarshal(t, listed))
	assert.Equal(t, "sess.project_mismatch", listed.(*api.SessProjectMismatch).Code)

	schema, err := client.GetMyUserSchema(t.Context(), api.GetMyUserSchemaParams{ProjectID: other})
	require.NoError(t, err)
	require.IsType(t, &api.SessProjectMismatch{}, schema, helpers.MustMarshal(t, schema))
	assert.Equal(t, "sess.project_mismatch", schema.(*api.SessProjectMismatch).Code)

	teams, err := client.ListMyTeams(t.Context(), api.ListMyTeamsParams{ProjectID: other})
	require.NoError(t, err)
	require.IsType(t, &api.SessProjectMismatch{}, teams, helpers.MustMarshal(t, teams))
	assert.Equal(t, "sess.project_mismatch", teams.(*api.SessProjectMismatch).Code)

	passkeys, err := client.ListMyPasskeys(t.Context(), api.ListMyPasskeysParams{ProjectID: other})
	require.NoError(t, err)
	require.IsType(t, &api.SessProjectMismatch{}, passkeys, helpers.MustMarshal(t, passkeys))
	assert.Equal(t, "sess.project_mismatch", passkeys.(*api.SessProjectMismatch).Code)

	links, err := client.ListMyIdentityLinks(t.Context(), api.ListMyIdentityLinksParams{ProjectID: other})
	require.NoError(t, err)
	require.IsType(t, &api.SessProjectMismatch{}, links, helpers.MustMarshal(t, links))
	assert.Equal(t, "sess.project_mismatch", links.(*api.SessProjectMismatch).Code)

	passwordState, err := client.GetMyPasswordState(t.Context(), api.GetMyPasswordStateParams{ProjectID: other})
	require.NoError(t, err)
	require.IsType(t, &api.SessProjectMismatch{}, passwordState, helpers.MustMarshal(t, passwordState))
	assert.Equal(t, "sess.project_mismatch", passwordState.(*api.SessProjectMismatch).Code)

	read, err = client.GetMyUser(t.Context(), api.GetMyUserParams{ProjectID: own})
	require.NoError(t, err)
	require.IsType(t, &api.User{}, read, helpers.MustMarshal(t, read))
	assert.Equal(t, api.UserID(user.ID), read.(*api.User).ID)
	assert.NotContains(t, read.(*api.User).Attributes, "nickname", "the refused patch changed nothing")

	patched, err = client.PatchMyUser(t.Context(), nickname("Myself"), api.PatchMyUserParams{ProjectID: own})
	require.NoError(t, err)
	require.IsType(t, &api.User{}, patched, helpers.MustMarshal(t, patched))
	assert.Equal(t, "Myself", userProp(t, *patched.(*api.User), "nickname"))

	listed, err = client.ListMyProjects(t.Context(), api.ListMyProjectsParams{ProjectID: own})
	require.NoError(t, err)
	require.IsType(t, &api.ListMyProjectsResponseHeaders{}, listed, helpers.MustMarshal(t, listed))

	schema, err = client.GetMyUserSchema(t.Context(), api.GetMyUserSchemaParams{ProjectID: own})
	require.NoError(t, err)
	require.IsType(t, &api.SchemaHeaders{}, schema, helpers.MustMarshal(t, schema))
	assert.Equal(t, read.(*api.User).Schema, schema.(*api.SchemaHeaders).Response.ID)

	teams, err = client.ListMyTeams(t.Context(), api.ListMyTeamsParams{ProjectID: own})
	require.NoError(t, err)
	require.IsType(t, &api.ListUserTeamsResponseHeaders{}, teams, helpers.MustMarshal(t, teams))

	passkeys, err = client.ListMyPasskeys(t.Context(), api.ListMyPasskeysParams{ProjectID: own})
	require.NoError(t, err)
	require.IsType(t, &api.ListUserPasskeysResponseHeaders{}, passkeys, helpers.MustMarshal(t, passkeys))

	links, err = client.ListMyIdentityLinks(t.Context(), api.ListMyIdentityLinksParams{ProjectID: own})
	require.NoError(t, err)
	require.IsType(t, &api.ListUserIdentityLinksResponseHeaders{}, links, helpers.MustMarshal(t, links))

	// The session was made with a password, so its state carries when it was set.
	passwordState, err = client.GetMyPasswordState(t.Context(), api.GetMyPasswordStateParams{ProjectID: own})
	require.NoError(t, err)
	require.IsType(t, &api.UserPasswordStateHeaders{}, passwordState, helpers.MustMarshal(t, passwordState))
	assert.True(t, passwordState.(*api.UserPasswordStateHeaders).Response.SetAt.IsSet())
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

	t.Run("a malformed page token is the caller's error", func(t *testing.T) {
		t.Parallel()

		_, user, client := dependencies(t)
		resp, err := client.ListUserPasskeys(t.Context(), api.ListUserPasskeysParams{
			UserID:    api.UserID(user.ID),
			PageToken: api.NewOptPageToken("not-a-token"),
		})
		require.NoError(t, err)
		require.IsType(t, &api.ListUserPasskeysBadRequest{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("req.invalid"), resp.(*api.ListUserPasskeysBadRequest).Code)
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

// TestSelfAccessReads: a person reads their own schema, roster, sign-in methods
// and password state with only their session, and anything short of a
// user-bound session gets the 401 the contract declares.
func TestSelfAccessReads(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	userID, teamID := harness.CreateUserOwnedByTeam(t, project.ID)
	cookie := sessionCookieIn(t, project, userID)

	t.Run("own schema, without a grant", func(t *testing.T) {
		t.Parallel()
		status, body := cookieRequest(t, cookie, http.MethodGet, "/users/me", "", nil)
		require.Equal(t, http.StatusOK, status, body)
		me := helpers.MustUnmarshal[api.User](t, []byte(body))

		status, body = cookieRequest(t, cookie, http.MethodGet, "/users/me/schema", "", nil)
		require.Equal(t, http.StatusOK, status, body)
		assert.Equal(t, me.Schema, helpers.MustUnmarshal[api.Schema](t, []byte(body)).ID)
	})

	t.Run("own teams, without a grant", func(t *testing.T) {
		t.Parallel()
		status, body := cookieRequest(t, cookie, http.MethodGet, "/users/me/teams", "", nil)
		require.Equal(t, http.StatusOK, status, body)
		teams := helpers.MustUnmarshal[api.ListUserTeamsResponse](t, []byte(body)).Teams
		require.Len(t, teams, 1)
		assert.Equal(t, teamID, string(teams[0].ID))
	})

	t.Run("own passkeys, without a grant", func(t *testing.T) {
		t.Parallel()
		harness.RegisterPasskey(t, project.ID, userID, "laptop")
		status, body := cookieRequest(t, cookie, http.MethodGet, "/users/me/passkeys", "", nil)
		require.Equal(t, http.StatusOK, status, body)
		passkeys := helpers.MustUnmarshal[api.ListUserPasskeysResponse](t, []byte(body)).Passkeys
		require.Len(t, passkeys, 1)
		assert.Equal(t, "laptop", passkeys[0].Name)
	})

	t.Run("own password state, without a grant", func(t *testing.T) {
		t.Parallel()
		// The user signs in with a cookie, not a password, so they have none.
		status, body := cookieRequest(t, cookie, http.MethodGet, "/users/me/password", "", nil)
		require.Equal(t, http.StatusOK, status, body)
		assert.False(t, helpers.MustUnmarshal[api.UserPasswordState](t, []byte(body)).SetAt.IsSet())
	})

	t.Run("own identity links, without a grant", func(t *testing.T) {
		t.Parallel()
		status, body := cookieRequest(t, cookie, http.MethodGet, "/users/me/identity_links", "", nil)
		require.Equal(t, http.StatusOK, status, body)
		assert.Empty(t, helpers.MustUnmarshal[api.ListUserIdentityLinksResponse](t, []byte(body)).IdentityLinks)
	})

	session := harness.CreateSession(t, project.ID, time.Hour)
	crypter, err := harness.EnsureKeyService(t).GetProjectCrypter(t.Context(), project.ID, domain.EncryptionKeyPurposeToken)
	require.NoError(t, err)
	anonymous, err := session.Token(crypter)
	require.NoError(t, err)

	for _, path := range []string{"/users/me", "/users/me/schema", "/users/me/teams", "/users/me/passkeys", "/users/me/identity_links", "/users/me/password"} {
		for name, cookie := range map[string]*http.Cookie{
			"anonymous session": {Name: "__nextgen_session", Value: anonymous},
			"no cookie":         nil,
		} {
			t.Run(path+" "+name, func(t *testing.T) {
				t.Parallel()
				status, body := cookieRequest(t, cookie, http.MethodGet, path, "", nil)
				assert.Equal(t, http.StatusUnauthorized, status, body)
				details := helpers.MustUnmarshal[api.ErrorDetails](t, []byte(body))
				assert.Equal(t, api.ErrorCode("auth.unauthorized"), details.Code)
				assert.Equal(t, "Missing or invalid session token.", details.Message)
			})
		}
	}
}

func TestListUserIdentityLinks(t *testing.T) {
	t.Parallel()

	dependencies := func(t *testing.T) (fixture idpFixture, user *domain.User) {
		fixture = newIdpFixture(t)
		user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
			ProjectID:  fixture.project.ID,
			SchemaURL:  test_data.UserSchemaURL,
			Attributes: harness.EnsureTestData(t).Generator.GenerateUser(t, "linked@example.com"),
		})
		require.NoError(t, err)
		return fixture, user
	}

	link := func(t *testing.T, projectID, connectionID, subject, userID string) *domain.IDPIdentityLink {
		t.Helper()
		link := &domain.IDPIdentityLink{ProjectID: projectID, ConnectionID: connectionID, Subject: subject, UserID: userID}
		require.NoError(t, harness.EnsureServiceDB(t).Statements().CreateIDPIdentityLink(t.Context(), link))
		return link
	}

	t.Run("lists the linked accounts oldest first, without the subject", func(t *testing.T) {
		t.Parallel()

		fixture, user := dependencies(t)
		google := fixture.create(t, helpers.OIDCConnection("google"))
		github := fixture.create(t, helpers.OIDCConnection("github"))
		first := link(t, fixture.project.ID, google.ID, "google-subject", user.ID)
		second := link(t, fixture.project.ID, github.ID, "github-subject", user.ID)

		resp, err := fixture.client.ListUserIdentityLinks(t.Context(), api.ListUserIdentityLinksParams{UserID: api.UserID(user.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.ListUserIdentityLinksResponse{}, resp, helpers.MustMarshal(t, resp))
		links := resp.(*api.ListUserIdentityLinksResponse).IdentityLinks
		require.Len(t, links, 2)
		assert.Equal(t, first.ID, links[0].ID)
		assert.Equal(t, google.ID, links[0].ConnectionID)
		assert.Equal(t, second.ID, links[1].ID)
		assert.Equal(t, github.ID, links[1].ConnectionID)
		assert.False(t, links[0].CreatedAt.IsZero())
		assert.NotContains(t, helpers.MustMarshal(t, resp), "google-subject")
	})

	t.Run("pages", func(t *testing.T) {
		t.Parallel()

		fixture, user := dependencies(t)
		google := fixture.create(t, helpers.OIDCConnection("google"))
		github := fixture.create(t, helpers.OIDCConnection("github"))
		link(t, fixture.project.ID, google.ID, "google-subject", user.ID)
		link(t, fixture.project.ID, github.ID, "github-subject", user.ID)

		resp, err := fixture.client.ListUserIdentityLinks(t.Context(), api.ListUserIdentityLinksParams{
			UserID: api.UserID(user.ID),
			Limit:  api.NewOptLimit(1),
		})
		require.NoError(t, err)
		require.IsType(t, &api.ListUserIdentityLinksResponse{}, resp, helpers.MustMarshal(t, resp))
		page := resp.(*api.ListUserIdentityLinksResponse)
		require.Len(t, page.IdentityLinks, 1)
		require.True(t, page.NextPageToken.IsSet())

		resp, err = fixture.client.ListUserIdentityLinks(t.Context(), api.ListUserIdentityLinksParams{
			UserID:    api.UserID(user.ID),
			Limit:     api.NewOptLimit(1),
			PageToken: api.NewOptPageToken(page.NextPageToken.Value),
		})
		require.NoError(t, err)
		require.IsType(t, &api.ListUserIdentityLinksResponse{}, resp, helpers.MustMarshal(t, resp))
		next := resp.(*api.ListUserIdentityLinksResponse)
		require.Len(t, next.IdentityLinks, 1)
		assert.NotEqual(t, page.IdentityLinks[0].ID, next.IdentityLinks[0].ID)
		assert.False(t, next.NextPageToken.IsSet())
	})

	t.Run("no links", func(t *testing.T) {
		t.Parallel()

		fixture, user := dependencies(t)
		resp, err := fixture.client.ListUserIdentityLinks(t.Context(), api.ListUserIdentityLinksParams{UserID: api.UserID(user.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.ListUserIdentityLinksResponse{}, resp, helpers.MustMarshal(t, resp))
		assert.Empty(t, resp.(*api.ListUserIdentityLinksResponse).IdentityLinks)
	})

	t.Run("unknown user returns 404", func(t *testing.T) {
		t.Parallel()

		fixture := newIdpFixture(t)
		resp, err := fixture.client.ListUserIdentityLinks(t.Context(), api.ListUserIdentityLinksParams{UserID: "user_does_not_exist"})
		require.NoError(t, err)
		require.IsType(t, &api.ListUserIdentityLinksNotFound{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("user.not_found"), resp.(*api.ListUserIdentityLinksNotFound).Code)
	})

	t.Run("a malformed page token is the caller's error", func(t *testing.T) {
		t.Parallel()

		fixture, user := dependencies(t)
		resp, err := fixture.client.ListUserIdentityLinks(t.Context(), api.ListUserIdentityLinksParams{
			UserID:    api.UserID(user.ID),
			PageToken: api.NewOptPageToken("not-a-token"),
		})
		require.NoError(t, err)
		require.IsType(t, &api.ListUserIdentityLinksBadRequest{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("req.invalid"), resp.(*api.ListUserIdentityLinksBadRequest).Code)
	})
}
