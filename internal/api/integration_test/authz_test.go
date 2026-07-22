//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
)

// TestManagementAuthz exercises the shared project-access guard across the
// management API (the operator plane of ADR 036), generalizing the access
// model settled for branding in ADR 037:
//
//   - Project binding with anti-oracle responses: a second, real project's
//     secret must not operate on the first project's resources, and the
//     answers must not reveal that the foreign project exists (identical to
//     the nonexistent-project responses).
//   - Plane separation: the preview secret ships to visitors' browsers by
//     design (project.read only), so the management API rejects it entirely
//     with 403 permission_denied — including on its own project.
//
// The guard rejects before any service or storage call, so foreign probes use
// fabricated resource ids; the schema subtests additionally probe a real
// resource id to pin that real data does not leak either.
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
	harness.SetProjectSecretOnApiClient(t, preview, other)

	victimID := api.ProjectID(victim.ID)

	t.Run("schemas", func(t *testing.T) {
		t.Parallel()

		// Real data in the victim project: the foreign read of its real id
		// must be indistinguishable from a nonexistent one.
		realSchemaID := harness.CreateUserSchema(t, victim, harness.TestData.Schemas.CreateSchemaRequestUserSchema)

		apiSchema := api.UserSchema{}
		require.NoError(t, apiSchema.UnmarshalJSON([]byte(harness.TestData.Schemas.CreateSchemaRequestUserSchema)))
		createReq := api.CreateSchemaReq{Type: api.UserSchemaCreateSchemaReq, UserSchema: apiSchema}

		t.Run("bound to the token's project", func(t *testing.T) {
			t.Parallel()

			resp, err := foreign.CreateSchema(t.Context(), createReq, api.CreateSchemaParams{ProjectID: victimID})
			require.NoError(t, err)
			assertAuthzError(t, resp, "sch.invalid_request")

			getResp, err := foreign.GetSchemaById(t.Context(), api.GetSchemaByIdParams{ID: realSchemaID, ProjectID: victimID})
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

			getResp, err := preview.GetSchemaById(t.Context(), api.GetSchemaByIdParams{ID: realSchemaID, ProjectID: victimID})
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

			getResp, err := foreign.GetFlowDefinition(t.Context(), api.GetFlowDefinitionParams{ProjectID: victimID, ID: "flowdef_irrelevant"})
			require.NoError(t, err)
			assertAuthzError(t, getResp, "flowdef.not_found")

			listResp, err := foreign.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{ProjectID: victimID})
			require.NoError(t, err)
			assertAuthzStatus(t, listResp, 404, "flowdef.not_found")

			updResp, err := foreign.UpdateFlowDefinition(t.Context(), newUpdateFlowDefinitionRequest(fixture), api.UpdateFlowDefinitionParams{ProjectID: victimID, ID: "flowdef_irrelevant"})
			require.NoError(t, err)
			assertAuthzError(t, updResp, "flowdef.invalid")

			delResp, err := foreign.DeleteFlowDefinition(t.Context(), api.DeleteFlowDefinitionParams{ProjectID: victimID, ID: "flowdef_irrelevant"})
			require.NoError(t, err)
			assertAuthzError(t, delResp, "flowdef.not_found")
		})

		t.Run("preview secret rejected", func(t *testing.T) {
			t.Parallel()

			resp, err := preview.CreateFlowDefinition(t.Context(), newCreateFlowDefinitionRequest(victimID, fixture))
			require.NoError(t, err)
			assertAuthzStatus(t, resp, 403, "flowdef.permission_denied")

			delResp, err := preview.DeleteFlowDefinition(t.Context(), api.DeleteFlowDefinitionParams{ProjectID: victimID, ID: "flowdef_irrelevant"})
			require.NoError(t, err)
			assertAuthzStatus(t, delResp, 403, "flowdef.permission_denied")

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

			getResp, err := foreign.GetUserByID(t.Context(), api.GetUserByIDParams{ProjectID: victimID, UserID: "user_irrelevant"})
			require.NoError(t, err)
			assertAuthzError(t, getResp, "user.not_found")

			pwResp, err := foreign.SetUserPassword(t.Context(), &api.SetUserPasswordRequest{Password: "hijacked-password"}, api.SetUserPasswordParams{ProjectID: victimID, UserID: "user_irrelevant"})
			require.NoError(t, err)
			assertAuthzError(t, pwResp, "user.invalid")
		})

		t.Run("preview secret rejected", func(t *testing.T) {
			t.Parallel()

			// The preview secret must not set passwords…
			pwResp, err := preview.SetUserPassword(t.Context(), &api.SetUserPasswordRequest{Password: "hijacked-password"}, api.SetUserPasswordParams{ProjectID: victimID, UserID: "user_irrelevant"})
			require.NoError(t, err)
			assertAuthzStatus(t, pwResp, 403, "user.permission_denied")

			// …and must not enumerate the project's users, even though the
			// operation is implicitly scoped to its own project.
			listResp, err := preview.ListUsers(t.Context(), api.ListUsersParams{})
			require.NoError(t, err)
			assertAuthzStatus(t, listResp, 403, "user.permission_denied")
		})
	})

	t.Run("teams", func(t *testing.T) {
		t.Parallel()

		t.Run("bound to the token's project", func(t *testing.T) {
			t.Parallel()

			resp, err := foreign.CreateTeam(t.Context(), &api.CreateTeamRequest{}, api.CreateTeamParams{ProjectID: victimID})
			require.NoError(t, err)
			assertAuthzError(t, resp, "team.project_not_found")

			getResp, err := foreign.GetTeam(t.Context(), api.GetTeamParams{ProjectID: victimID, TeamID: "team_irrelevant"})
			require.NoError(t, err)
			assertAuthzError(t, getResp, "team.team_not_found")
		})

		t.Run("preview secret rejected", func(t *testing.T) {
			t.Parallel()

			resp, err := preview.CreateTeam(t.Context(), &api.CreateTeamRequest{}, api.CreateTeamParams{ProjectID: victimID})
			require.NoError(t, err)
			assertAuthzStatus(t, resp, 403, "team.permission_denied")
		})

		t.Run("unauthenticated create is a 401", func(t *testing.T) {
			t.Parallel()

			anon, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
			require.NoError(t, err)

			// createTeam declared security: [] before the guard landed; the
			// typed unauthorized decode pins that a bearer is now mandatory.
			resp, err := anon.CreateTeam(t.Context(), &api.CreateTeamRequest{}, api.CreateTeamParams{ProjectID: victimID})
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
			harness.SetProjectSecretOnApiClient(t, ownClient, other)

			missingResp, err := ownClient.GetProject(t.Context(), api.GetProjectParams{ProjectID: api.ProjectID("proj_does_not_exist")})
			require.NoError(t, err)
			require.IsType(t, &api.GetProjectNotFound{}, missingResp, helpers.MustMarshal(t, missingResp))

			assert.Equal(t, "proj.not_found", string(foreignResp.(*api.GetProjectNotFound).Code))
			assert.Equal(t, foreignResp.(*api.GetProjectNotFound).Code, missingResp.(*api.GetProjectNotFound).Code,
				"foreign and nonexistent projects must answer identically")

			okResp, err := ownClient.GetProject(t.Context(), api.GetProjectParams{ProjectID: victimID})
			require.NoError(t, err)
			assert.IsType(t, &api.GetProjectResponse{}, okResp, helpers.MustMarshal(t, okResp))
		})

		t.Run("preview secret rejected", func(t *testing.T) {
			t.Parallel()

			resp, err := preview.GetProject(t.Context(), api.GetProjectParams{ProjectID: victimID})
			require.NoError(t, err)
			assertAuthzStatus(t, resp, 403, "proj.permission_denied")
		})
	})
}

// authzErrorParts extracts (status, code) from any error-shaped response the
// generated client returns: declared statuses decode into typed
// ErrorDetails-shaped values (status not carried, reported as 0), undeclared
// ones into *api.ErrorDetailsStatusCode.
func authzErrorParts(t *testing.T, resp any) (status int, code string) {
	t.Helper()
	if e, ok := resp.(*api.ErrorDetailsStatusCode); ok {
		return e.StatusCode, string(e.Response.Code)
	}
	var body struct {
		Code string `json:"code"`
	}
	require.NoError(t, json.Unmarshal([]byte(helpers.MustMarshal(t, resp)), &body), "response is not error-shaped: %T", resp)
	require.NotEmpty(t, body.Code, "response is not error-shaped: %T: %s", resp, helpers.MustMarshal(t, resp))
	return 0, body.Code
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
