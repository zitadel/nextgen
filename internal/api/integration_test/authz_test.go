//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/service"
)

// TestManagementAuthz exercises the authz resolver gate across the
// management API (the operator plane of ADR 036):
//
//   - Project foothold with anti-oracle responses: a second, real project's
//     secret must not operate on the first project's resources, and the
//     answers must not reveal that the foreign project exists (identical to
//     the nonexistent-project / no-foothold responses → 404 shapes).
//   - Plane separation: the preview secret ships to visitors' browsers by
//     design (project.read only), so the management API rejects it entirely
//     with 403 permission_denied — including on its own project.
//   - CreateProject seeds an sk_proj grant so the returned project secret
//     can set up the project through resolver.Check.
func TestManagementAuthz(t *testing.T) {
	t.Parallel()

	victim, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	// foreign holds a real, valid project secret — for the wrong project.
	foreign, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, foreign, other)

	// preview holds the victim's own browser-plane preview secret.
	preview, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetPreviewSecretOnApiClient(t, preview, victim)

	victimID := api.ProjectID(victim.ID)

	t.Run("schemas", func(t *testing.T) {
		t.Parallel()

		// Real data in the victim project: the foreign read of its real id
		// must be indistinguishable from a nonexistent one.
		realSchemaID := harness.CreateUserSchema(t, victim, harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)

		apiSchema := api.UserSchema{}
		require.NoError(t, apiSchema.UnmarshalJSON([]byte(harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)))
		createReq := api.CreateSchemaReq{Type: api.UserSchemaCreateSchemaReq, UserSchema: apiSchema}

		t.Run("bound to the token's project", func(t *testing.T) {
			t.Parallel()

			resp, err := foreign.CreateSchema(t.Context(), createReq, api.CreateSchemaParams{ProjectID: victimID})
			require.NoError(t, err)
			assertAuthzError(t, resp, "sch.invalid_request")

			getResp, err := foreign.GetSchemaById(t.Context(), api.GetSchemaByIdParams{ID: realSchemaID})
			require.NoError(t, err)
			assertAuthzError(t, getResp, "sch.not_found")

			listResp, err := foreign.ListSchemas(t.Context(), api.ListSchemasParams{ProjectID: victimID})
			require.NoError(t, err)
			assertAuthzStatus(t, listResp, 404, "sch.not_found")
		})

		t.Run("preview secret rejected", func(t *testing.T) {
			t.Parallel()

			resp, err := preview.CreateSchema(t.Context(), createReq, api.CreateSchemaParams{ProjectID: victimID})
			require.NoError(t, err)
			assertAuthzStatus(t, resp, 403, "sch.permission_denied")

			getResp, err := preview.GetSchemaById(t.Context(), api.GetSchemaByIdParams{ID: realSchemaID})
			require.NoError(t, err)
			assertAuthzStatus(t, getResp, 403, "sch.permission_denied")
		})
	})

	t.Run("flow definitions", func(t *testing.T) {
		t.Parallel()

		fixture := newFlowDefinitionFixture("authz-probe", helpers.BuiltinSchemaBaseURL+"/user-schema.json")

		t.Run("bound to the token's project", func(t *testing.T) {
			t.Parallel()

			resp, err := foreign.CreateFlowDefinition(t.Context(), newCreateFlowDefinitionRequest(victimID, fixture))
			require.NoError(t, err)
			assertAuthzError(t, resp, "flowdef.invalid")

			getResp, err := foreign.GetFlowDefinition(t.Context(), api.GetFlowDefinitionParams{ID: "flowdef_irrelevant"})
			require.NoError(t, err)
			assertAuthzError(t, getResp, "flowdef.not_found")

			listResp, err := foreign.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{ProjectID: victimID})
			require.NoError(t, err)
			assertAuthzStatus(t, listResp, 404, "flowdef.not_found")

			updResp, err := foreign.UpdateFlowDefinition(t.Context(), newUpdateFlowDefinitionRequest(fixture), api.UpdateFlowDefinitionParams{ID: "flowdef_irrelevant"})
			require.NoError(t, err)
			assertAuthzError(t, updResp, "flowdef.not_found")

			// Fabricated ids miss RSI → idempotent delete 204 (same as never existed).
			delResp, err := foreign.DeleteFlowDefinition(t.Context(), api.DeleteFlowDefinitionParams{ID: "flowdef_irrelevant"})
			require.NoError(t, err)
			assert.IsType(t, &api.DeleteFlowDefinitionNoContent{}, delResp, helpers.MustMarshal(t, delResp))
		})

		t.Run("preview secret rejected", func(t *testing.T) {
			t.Parallel()

			resp, err := preview.CreateFlowDefinition(t.Context(), newCreateFlowDefinitionRequest(victimID, fixture))
			require.NoError(t, err)
			assertAuthzStatus(t, resp, 403, "flowdef.permission_denied")

			listResp, err := preview.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{ProjectID: victimID})
			require.NoError(t, err)
			assertAuthzStatus(t, listResp, 403, "flowdef.permission_denied")
		})
	})

	t.Run("users", func(t *testing.T) {
		t.Parallel()

		userJSON := helpers.MustMarshal(t, map[string]any{
			"$schema":    "https://test.example.schemas.com/schemas/default-human-user.json",
			"email":      "authz-probe@example.com",
			"givenName":  "Authz",
			"familyName": "Probe",
			"password":   "my-strong-password",
		})

		t.Run("bound to the token's project", func(t *testing.T) {
			t.Parallel()

			var createBody api.User
			require.NoError(t, createBody.UnmarshalJSON([]byte(userJSON)))
			resp, err := foreign.CreateUser(t.Context(), &createBody, api.CreateUserParams{ProjectID: victimID})
			require.NoError(t, err)
			assertAuthzError(t, resp, "user.invalid")

			getResp, err := foreign.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: "user_irrelevant"})
			require.NoError(t, err)
			assertAuthzError(t, getResp, "user.not_found")

			pwResp, err := foreign.SetUserPassword(t.Context(), &api.SetUserPasswordRequest{Password: "hijacked-password"}, api.SetUserPasswordParams{UserID: "user_irrelevant"})
			require.NoError(t, err)
			assertAuthzError(t, pwResp, "user.not_found")

			delResp, err := foreign.DeleteUserByID(t.Context(), api.DeleteUserByIDParams{UserID: "user_irrelevant"})
			require.NoError(t, err)
			assert.IsType(t, &api.DeleteUserByIDNoContent{}, delResp, helpers.MustMarshal(t, delResp))
		})

		t.Run("a foreign delete of a real user leaves it standing", func(t *testing.T) {
			t.Parallel()

			// The other probes use fabricated ids because the guard rejects
			// before the service. A delete is worth proving against real data:
			// the answer must not distinguish the user from a nonexistent one,
			// and the user must survive.
			victimUser, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
				ProjectID: victim.ID,
				User:      harness.EnsureTestData(t).Generator.GenerateUser(t, "authz-delete-probe@example.com"),
			})
			require.NoError(t, err)
			victimUserID := api.UserID(victimUser["id"].(string))

			delResp, err := foreign.DeleteUserByID(t.Context(), api.DeleteUserByIDParams{UserID: victimUserID})
			require.NoError(t, err)
			assertAuthzError(t, delResp, "user.not_found")

			ownClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
			require.NoError(t, err)
			harness.SetProjectSecretOnApiClient(t, ownClient, victim)

			getResp, err := ownClient.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: victimUserID})
			require.NoError(t, err)
			assert.IsType(t, &api.User{}, getResp, helpers.MustMarshal(t, getResp))

			// The owner's secret does reach the delete: project.write implies
			// user.delete, so the rejection above was the binding, not the op.
			ownDelResp, err := ownClient.DeleteUserByID(t.Context(), api.DeleteUserByIDParams{UserID: victimUserID})
			require.NoError(t, err)
			assert.IsType(t, &api.DeleteUserByIDNoContent{}, ownDelResp, helpers.MustMarshal(t, ownDelResp))
		})

		t.Run("preview secret rejected", func(t *testing.T) {
			t.Parallel()

			// Preview ceiling (403) on list; fabricated by-id misses RSI before
			// the ceiling (write → not_found, delete → 204).
			pwResp, err := preview.SetUserPassword(t.Context(), &api.SetUserPasswordRequest{Password: "hijacked-password"}, api.SetUserPasswordParams{UserID: "user_irrelevant"})
			require.NoError(t, err)
			assertAuthzError(t, pwResp, "user.not_found")

			listResp, err := preview.ListUsers(t.Context(), api.ListUsersParams{})
			require.NoError(t, err)
			assertAuthzStatus(t, listResp, 403, "user.permission_denied")
		})
	})

	t.Run("teams", func(t *testing.T) {
		t.Parallel()

		t.Run("bound to the token's project", func(t *testing.T) {
			t.Parallel()

			resp, err := foreign.CreateTeam(t.Context(), &api.CreateTeamRequest{Name: helpers.TeamName()}, api.CreateTeamParams{ProjectID: victimID})
			require.NoError(t, err)
			assertAuthzError(t, resp, "team.project_not_found")

			getResp, err := foreign.GetTeam(t.Context(), api.GetTeamParams{TeamID: "team_irrelevant"})
			require.NoError(t, err)
			assertAuthzError(t, getResp, "team.team_not_found")

			updateResp, err := foreign.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: api.NewOptString(helpers.TeamName())}, api.UpdateTeamParams{TeamID: "team_irrelevant"})
			require.NoError(t, err)
			assertAuthzError(t, updateResp, "team.team_not_found")

			// A read of a foreign project answers "nothing there", so a
			// listing cannot be used to prove the project exists.
			queryResp, err := foreign.QueryTeams(t.Context(), &api.QueryTeamsRequest{}, api.QueryTeamsParams{ProjectID: victimID})
			require.NoError(t, err)
			assertAuthzError(t, queryResp, "team.team_not_found")
		})

		t.Run("preview secret rejected", func(t *testing.T) {
			t.Parallel()

			resp, err := preview.CreateTeam(t.Context(), &api.CreateTeamRequest{Name: helpers.TeamName()}, api.CreateTeamParams{ProjectID: victimID})
			require.NoError(t, err)
			require.IsType(t, &api.CreateTeamForbidden{}, resp, helpers.MustMarshal(t, resp))
			assertAuthzError(t, resp, "team.permission_denied")

			updateResp, err := preview.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: api.NewOptString(helpers.TeamName())}, api.UpdateTeamParams{TeamID: "team_irrelevant"})
			require.NoError(t, err)
			// Fabricated path id misses RSI before the preview ceiling runs.
			assertAuthzError(t, updateResp, "team.team_not_found")

			queryResp, err := preview.QueryTeams(t.Context(), &api.QueryTeamsRequest{}, api.QueryTeamsParams{ProjectID: victimID})
			require.NoError(t, err)
			require.IsType(t, &api.QueryTeamsForbidden{}, queryResp, helpers.MustMarshal(t, queryResp))
			assertAuthzError(t, queryResp, "team.permission_denied")
		})

		t.Run("unauthenticated create is a 401", func(t *testing.T) {
			t.Parallel()

			anon, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
			require.NoError(t, err)

			// createTeam declared security: [] before the guard landed; the
			// typed unauthorized decode pins that a bearer is now mandatory.
			resp, err := anon.CreateTeam(t.Context(), &api.CreateTeamRequest{Name: helpers.TeamName()}, api.CreateTeamParams{ProjectID: victimID})
			require.NoError(t, err)
			require.IsType(t, &api.CreateTeamUnauthorized{}, resp, helpers.MustMarshal(t, resp))
			assertAuthzError(t, resp, "auth.unauthorized")
		})
	})

	t.Run("project", func(t *testing.T) {
		t.Parallel()

		t.Run("bound to the token's project", func(t *testing.T) {
			t.Parallel()

			// The foreign answer must match the nonexistent answer exactly.
			// getProject declares its 404, so the generated client decoding
			// both into *api.GetProjectNotFound proves the status; the codes
			// must then be byte-identical.
			foreignResp, err := foreign.GetProject(t.Context(), api.GetProjectParams{ProjectID: victimID})
			require.NoError(t, err)
			require.IsType(t, &api.GetProjectNotFound{}, foreignResp, helpers.MustMarshal(t, foreignResp))

			ownClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
			require.NoError(t, err)
			harness.SetProjectSecretOnApiClient(t, ownClient, victim)

			missingResp, err := ownClient.GetProject(t.Context(), api.GetProjectParams{ProjectID: api.ProjectID("proj_does_not_exist")})
			require.NoError(t, err)
			require.IsType(t, &api.GetProjectNotFound{}, missingResp, helpers.MustMarshal(t, missingResp))

			assert.Equal(t, "proj.not_found", string(foreignResp.(*api.GetProjectNotFound).Code))
			assert.Equal(t, foreignResp.(*api.GetProjectNotFound).Code, missingResp.(*api.GetProjectNotFound).Code,
				"foreign and nonexistent projects must answer identically")

			okResp, err := ownClient.GetProject(t.Context(), api.GetProjectParams{ProjectID: victimID})
			require.NoError(t, err)
			assert.IsType(t, &api.ProjectResponse{}, okResp, helpers.MustMarshal(t, okResp))
		})

		t.Run("preview secret rejected", func(t *testing.T) {
			t.Parallel()

			resp, err := preview.GetProject(t.Context(), api.GetProjectParams{ProjectID: victimID})
			require.NoError(t, err)
			assertAuthzStatus(t, resp, 403, "proj.permission_denied")
		})

		t.Run("preview secret cannot patch", func(t *testing.T) {
			t.Parallel()

			resp, err := preview.PatchProject(t.Context(),
				&api.PatchProjectRequest{Name: api.NewOptNilString(helpers.ProjectName())},
				api.PatchProjectParams{ProjectID: victimID},
			)
			require.NoError(t, err)
			assertAuthzStatus(t, resp, 403, "proj.permission_denied")
		})

		t.Run("query projects", func(t *testing.T) {
			t.Parallel()

			t.Run("bound to the token's project", func(t *testing.T) {
				t.Parallel()

				// queryProjects is scoped to the caller's bound project: each secret sees
				// exactly its own project and never one it isn't bound to (foreign, bound to
				// other, must not see victim).
				resp, err := foreign.QueryProjects(t.Context(), &api.QueryProjectsRequest{})
				require.NoError(t, err)
				require.IsType(t, &api.QueryProjectsResponse{}, resp, helpers.MustMarshal(t, resp))
				listResp := resp.(*api.QueryProjectsResponse)
				require.Len(t, listResp.Projects, 1, "the foreign secret sees only its own project")
				assert.Equal(t, other.ID, listResp.Projects[0].ID, "the foreign secret sees exactly its own project (other)")

				// a client with the own secret sees its own project.
				ownClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
				require.NoError(t, err)
				harness.SetProjectSecretOnApiClient(t, ownClient, victim)

				ownResp, err := ownClient.QueryProjects(t.Context(), &api.QueryProjectsRequest{})
				require.NoError(t, err)
				require.IsType(t, &api.QueryProjectsResponse{}, ownResp, helpers.MustMarshal(t, ownResp))
				ownListResp := ownResp.(*api.QueryProjectsResponse)
				require.Len(t, ownListResp.Projects, 1, "the own secret sees only its own project")
				assert.Equal(t, victim.ID, ownListResp.Projects[0].ID, "the own secret sees exactly its own project (victim)")
			})

			t.Run("preview secret rejected", func(t *testing.T) {
				t.Parallel()

				resp, err := preview.QueryProjects(t.Context(), &api.QueryProjectsRequest{})
				require.NoError(t, err)
				assertAuthzError(t, resp, "proj.permission_denied")
			})
		})
	})
}

// errorResponseParts pulls the status and error body out of any error-shaped
// response the generated client returns. Three shapes exist:
//
//   - an operation whose contract declares an operation-specific default
//     response decodes into a <Operation>ErrorResponseStatusCode wrapper, which
//     carries the status beside a discriminated union of that operation's
//     errors;
//   - an operation still on the shared default decodes into the generic
//     *api.ErrorDetailsStatusCode;
//   - a declared status decodes into a bare ErrorDetails-shaped value that does
//     not carry its status at all, reported here as 0.
//
// The wrapper is matched structurally rather than by listing its types, so
// wiring another operation to an operation-specific response needs no case
// added here.
func errorResponseParts(t *testing.T, resp any) (status int, code, message string, ok bool) {
	t.Helper()

	if e, isGeneric := resp.(*api.ErrorDetailsStatusCode); isGeneric {
		return e.StatusCode, string(e.Response.Code), e.Response.Message, true
	}

	body := resp
	if v := reflect.Indirect(reflect.ValueOf(resp)); v.Kind() == reflect.Struct {
		statusField := v.FieldByName("StatusCode")
		responseField := v.FieldByName("Response")
		if statusField.IsValid() && statusField.Kind() == reflect.Int && responseField.IsValid() {
			status = int(statusField.Int())
			body = responseField.Interface()
		}
	}

	var parsed struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if json.Unmarshal([]byte(helpers.MustMarshal(t, body)), &parsed) != nil || parsed.Code == "" {
		return 0, "", "", false
	}
	return status, parsed.Code, parsed.Message, true
}

// authzErrorParts extracts (status, code) from any error-shaped response.
func authzErrorParts(t *testing.T, resp any) (status int, code string) {
	t.Helper()
	status, code, _, ok := errorResponseParts(t, resp)
	require.True(t, ok, "response is not error-shaped: %T: %s", resp, helpers.MustMarshal(t, resp))
	return status, code
}

// assertAuthzError asserts the response is the error with the given code,
// regardless of whether its status is declared in the contract.
func assertAuthzError(t *testing.T, resp any, wantCode string) {
	t.Helper()
	_, code := authzErrorParts(t, resp)
	assert.Equal(t, wantCode, code, helpers.MustMarshal(t, resp))
}

// assertAuthzStatus asserts an undeclared-status error response (guard
// rejections surface through the default error response) with its HTTP
// status and code.
func assertAuthzStatus(t *testing.T, resp any, wantStatus int, wantCode string) {
	t.Helper()
	status, code := authzErrorParts(t, resp)
	assert.Equal(t, wantStatus, status, helpers.MustMarshal(t, resp))
	assert.Equal(t, wantCode, code, helpers.MustMarshal(t, resp))
}
