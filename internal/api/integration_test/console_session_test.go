//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/api/integration_test/test_data"
)

// TestConsoleManagementAcceptsSession pins #1300 §1: the embedded Console
// holds only __nextgen_session, so every management operation its screens
// call must accept that cookie as the signed-in user. The caller holds a
// direct admin grant on the platform project it signed in to, so home and
// target project are the same -- the single-project deployment. (The owning
// team slot of the shared platform project is TestTeamReadsAcceptSession's.)
func TestConsoleManagementAcceptsSession(t *testing.T) {
	t.Parallel()

	console := harness.EnsurePlatformProject(t)
	claimerID, _ := harness.CreateUserOwnedByTeam(t, console.ID)
	harness.SeedProjectAdmin(t, console.ID, claimerID)

	session := sessionClientForUser(t, claimerID)
	projectID := api.ProjectID(console.ID)

	t.Run("schemas", func(t *testing.T) {
		t.Parallel()
		resp, err := session.ListSchemas(t.Context(), api.ListSchemasParams{ProjectID: projectID})
		require.NoError(t, err)
		listed, ok := resp.(*api.ListSchemasResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		require.NotEmpty(t, listed.Schemas, "the platform project is seeded with defaults")

		got, err := session.GetSchemaById(t.Context(), api.GetSchemaByIdParams{ID: listed.Schemas[0].ID})
		require.NoError(t, err)
		require.IsType(t, &api.Schema{}, got, helpers.MustMarshal(t, got))
	})

	t.Run("flow definitions", func(t *testing.T) {
		t.Parallel()
		resp, err := session.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{ProjectID: projectID})
		require.NoError(t, err)
		listed, ok := resp.(*api.FlowDefinitionListResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		require.NotEmpty(t, listed.FlowDefinitions, "the platform project is seeded with defaults")

		got, err := session.GetFlowDefinition(t.Context(), api.GetFlowDefinitionParams{ID: listed.FlowDefinitions[0].ID})
		require.NoError(t, err)
		require.IsType(t, &api.FlowDefinitionResponse{}, got, helpers.MustMarshal(t, got))
	})

	t.Run("branding", func(t *testing.T) {
		t.Parallel()
		// Branding is not seeded, and creating it stays secret-only.
		secret, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, secret, console)
		created, err := secret.CreateBranding(t.Context(), &api.Branding{
			Layout: api.NewOptBrandingLayout(api.BrandingLayoutSplit),
		}, api.CreateBrandingParams{ProjectID: projectID})
		require.NoError(t, err)
		revision, ok := created.(*api.BrandingRevisionResponse)
		require.True(t, ok, helpers.MustMarshal(t, created))

		resp, err := session.ListBranding(t.Context(), api.ListBrandingParams{ProjectID: projectID})
		require.NoError(t, err)
		listed, ok := resp.(*api.ListBrandingResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		require.True(t, slices.ContainsFunc(*listed, func(item api.ListBrandingResponseItem) bool {
			return item.ID == revision.ID
		}), helpers.MustMarshal(t, listed))

		got, err := session.GetBrandingById(t.Context(), api.GetBrandingByIdParams{ID: revision.ID})
		require.NoError(t, err)
		require.IsType(t, &api.BrandingRevisionResponse{}, got, helpers.MustMarshal(t, got))
	})

	t.Run("teams", func(t *testing.T) {
		t.Parallel()
		created, err := session.CreateTeam(t.Context(), &api.CreateTeamRequest{Name: helpers.TeamName()},
			api.CreateTeamParams{ProjectID: projectID})
		require.NoError(t, err)
		team, ok := created.(*api.TeamResponse)
		require.True(t, ok, helpers.MustMarshal(t, created))

		renamed := helpers.TeamName()
		updated, err := session.UpdateTeam(t.Context(),
			&api.UpdateTeamRequest{Name: api.NewOptString(renamed)},
			api.UpdateTeamParams{TeamID: api.TeamID(team.ID)})
		require.NoError(t, err)
		got, ok := updated.(*api.TeamResponse)
		require.True(t, ok, helpers.MustMarshal(t, updated))
		require.Equal(t, renamed, got.Name)
	})

	t.Run("users", func(t *testing.T) {
		t.Parallel()
		req := &api.CreateUserRequest{}
		require.NoError(t, req.UnmarshalJSON([]byte(helpers.MustMarshal(t, map[string]any{
			"schema": test_data.UserSchemaURL,
			"attributes": map[string]any{
				"email":    fmt.Sprintf("console-session-%s@example.com", claimerID),
				"password": "my-strong-password",
			},
		}))))
		created, err := session.CreateUser(t.Context(), req, api.CreateUserParams{ProjectID: projectID})
		require.NoError(t, err)
		user, ok := created.(*api.User)
		require.True(t, ok, helpers.MustMarshal(t, created))

		got, err := session.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: user.ID})
		require.NoError(t, err)
		require.IsType(t, &api.User{}, got, helpers.MustMarshal(t, got))

		deleted, err := session.DeleteUserByID(t.Context(), api.DeleteUserByIDParams{UserID: user.ID})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteUserByIDNoContent{}, deleted, helpers.MustMarshal(t, deleted))
	})
}

// TestConsoleManagementSessionWithoutAccess pins the other half: accepting
// the cookie is not authorizing it. A signed-in user with no grant on a
// project neither reads nor writes there, and gets the not-found shape rather
// than a 401 (the cookie was accepted) or a 403 (there is no foothold).
func TestConsoleManagementSessionWithoutAccess(t *testing.T) {
	t.Parallel()

	console := harness.EnsurePlatformProject(t)
	strangerID, _ := harness.CreateUserOwnedByTeam(t, console.ID)
	session := sessionClientForUser(t, strangerID)

	other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	otherID := api.ProjectID(other.ID)

	t.Run("cannot list another project's schemas", func(t *testing.T) {
		resp, err := session.ListSchemas(t.Context(), api.ListSchemasParams{ProjectID: otherID})
		require.NoError(t, err)
		require.IsType(t, &api.ListSchemasErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
		denied := resp.(*api.ListSchemasErrorResponseStatusCode)
		assert.Equal(t, http.StatusNotFound, denied.StatusCode)
		assert.True(t, denied.Response.IsSchNotFound(), helpers.MustMarshal(t, resp))
	})

	t.Run("cannot list another project's flow definitions", func(t *testing.T) {
		resp, err := session.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{ProjectID: otherID})
		require.NoError(t, err)
		require.IsType(t, &api.ListFlowDefinitionsErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
		denied := resp.(*api.ListFlowDefinitionsErrorResponseStatusCode)
		assert.Equal(t, http.StatusNotFound, denied.StatusCode)
		assert.True(t, denied.Response.IsFlowdefNotFound(), helpers.MustMarshal(t, resp))
	})

	t.Run("cannot list another project's branding", func(t *testing.T) {
		resp, err := session.ListBranding(t.Context(), api.ListBrandingParams{ProjectID: otherID})
		require.NoError(t, err)
		require.IsType(t, &api.ErrorDetailsStatusCode{}, resp, helpers.MustMarshal(t, resp))
		denied := resp.(*api.ErrorDetailsStatusCode)
		assert.Equal(t, http.StatusNotFound, denied.StatusCode)
		assert.Equal(t, api.ErrorCode("brnd.not_found"), denied.Response.Code)
	})

	t.Run("cannot create a team in another project", func(t *testing.T) {
		resp, err := session.CreateTeam(t.Context(), &api.CreateTeamRequest{Name: helpers.TeamName()},
			api.CreateTeamParams{ProjectID: otherID})
		require.NoError(t, err)
		require.IsType(t, &api.CreateTeamNotFound{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("team.project_not_found"), resp.(*api.CreateTeamNotFound).Code)
	})

	t.Run("cannot read another project's user", func(t *testing.T) {
		foreignUserID, _ := harness.CreateUserOwnedByTeam(t, other.ID)
		resp, err := session.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(foreignUserID)})
		require.NoError(t, err)
		require.IsType(t, &api.GetUserByIDNotFound{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("user.not_found"), resp.(*api.GetUserByIDNotFound).Code)
	})

	// The by-id operations resolve the path id before authorizing, so each is
	// pinned too: a foreign resource must stay the not-found shape.
	foreignUserID, foreignTeamID := harness.CreateUserOwnedByTeam(t, other.ID)
	otherSecret, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, otherSecret, other)

	t.Run("cannot delete another project's user", func(t *testing.T) {
		resp, err := session.DeleteUserByID(t.Context(), api.DeleteUserByIDParams{UserID: api.UserID(foreignUserID)})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteUserByIDNotFound{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("user.not_found"), resp.(*api.DeleteUserByIDNotFound).Code)
	})

	t.Run("cannot update another project's team", func(t *testing.T) {
		resp, err := session.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: api.NewOptString(helpers.TeamName())},
			api.UpdateTeamParams{TeamID: api.TeamID(foreignTeamID)})
		require.NoError(t, err)
		require.IsType(t, &api.UpdateTeamNotFound{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("team.team_not_found"), resp.(*api.UpdateTeamNotFound).Code)
	})

	t.Run("cannot read another project's schema", func(t *testing.T) {
		// A managed sch_* id, unique to the other project: the seeded default
		// carries the same $id in every project, which is a different question.
		schemaJSON := []byte(harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)
		var schemaObj map[string]any
		require.NoError(t, json.Unmarshal(schemaJSON, &schemaObj))
		delete(schemaObj, "$id")
		schemaJSON, err := json.Marshal(schemaObj)
		require.NoError(t, err)
		schemaID := harness.CreateUserSchema(t, other, string(schemaJSON))

		resp, err := session.GetSchemaById(t.Context(), api.GetSchemaByIdParams{ID: schemaID})
		require.NoError(t, err)
		require.IsType(t, &api.GetSchemaByIdErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
		denied := resp.(*api.GetSchemaByIdErrorResponseStatusCode)
		assert.Equal(t, http.StatusNotFound, denied.StatusCode)
		assert.True(t, denied.Response.IsSchNotFound(), helpers.MustMarshal(t, resp))
	})

	t.Run("cannot read another project's flow definition", func(t *testing.T) {
		listed, err := otherSecret.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{ProjectID: otherID})
		require.NoError(t, err)
		flows, ok := listed.(*api.FlowDefinitionListResponse)
		require.True(t, ok, helpers.MustMarshal(t, listed))
		require.NotEmpty(t, flows.FlowDefinitions)

		resp, err := session.GetFlowDefinition(t.Context(), api.GetFlowDefinitionParams{ID: flows.FlowDefinitions[0].ID})
		require.NoError(t, err)
		require.IsType(t, &api.GetFlowDefinitionErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
		denied := resp.(*api.GetFlowDefinitionErrorResponseStatusCode)
		assert.Equal(t, http.StatusNotFound, denied.StatusCode)
		assert.True(t, denied.Response.IsFlowdefNotFound(), helpers.MustMarshal(t, resp))
	})

	t.Run("cannot read another project's branding", func(t *testing.T) {
		created, err := otherSecret.CreateBranding(t.Context(), &api.Branding{
			Layout: api.NewOptBrandingLayout(api.BrandingLayoutSplit),
		}, api.CreateBrandingParams{ProjectID: otherID})
		require.NoError(t, err)
		revision, ok := created.(*api.BrandingRevisionResponse)
		require.True(t, ok, helpers.MustMarshal(t, created))

		resp, err := session.GetBrandingById(t.Context(), api.GetBrandingByIdParams{ID: revision.ID})
		require.NoError(t, err)
		require.IsType(t, &api.ErrorDetails{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("brnd.not_found"), resp.(*api.ErrorDetails).Code)
	})
}

// TestConsoleSessionListsTargetProject pins #1300 §2: a platform
// operator signs in to the platform project and manages a customer project
// through a grant, so home and target differ. `project_id` on queryUsers names
// the target; without it the home project is listed, as before.
func TestConsoleSessionListsTargetProject(t *testing.T) {
	t.Parallel()

	console := harness.EnsurePlatformProject(t)
	operatorID, _ := harness.CreateUserOwnedByTeam(t, console.ID)

	customer, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	harness.SeedProjectAdmin(t, customer.ID, operatorID)
	customerUserID, _ := harness.CreateUserOwnedByTeam(t, customer.ID)

	session := sessionClientForUser(t, operatorID)
	target := api.QueryUsersParams{ProjectID: api.NewOptProjectID(api.ProjectID(customer.ID))}

	t.Run("lists the customer project's users", func(t *testing.T) {
		t.Parallel()
		resp, err := session.QueryUsers(t.Context(), &api.QueryUsersRequest{}, target)
		require.NoError(t, err)
		listed, ok := resp.(*api.QueryUsersResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		ids := make([]string, 0, len(listed.Users))
		for _, item := range listed.Users {
			ids = append(ids, userID(t, item))
		}
		require.Contains(t, ids, customerUserID)
		require.NotContains(t, ids, operatorID, "the operator is homed in the platform project")
	})

	// The other list screens already took project_id; with #1300 §1 they
	// accept the cookie too, so the whole screen set follows the selection.
	t.Run("lists the customer project's schemas", func(t *testing.T) {
		t.Parallel()
		resp, err := session.ListSchemas(t.Context(), api.ListSchemasParams{ProjectID: api.ProjectID(customer.ID)})
		require.NoError(t, err)
		listed, ok := resp.(*api.ListSchemasResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		require.NotEmpty(t, listed.Schemas)
	})

	t.Run("a project secret stays bound to its own project", func(t *testing.T) {
		t.Parallel()
		secret, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, secret, console)

		resp, err := secret.QueryUsers(t.Context(), &api.QueryUsersRequest{}, target)
		require.NoError(t, err)
		requireUsersNotFound(t, resp)
	})

	t.Run("without a grant the target is not listed", func(t *testing.T) {
		t.Parallel()
		strangerID, _ := harness.CreateUserOwnedByTeam(t, console.ID)
		stranger := sessionClientForUser(t, strangerID)
		resp, err := stranger.QueryUsers(t.Context(), &api.QueryUsersRequest{}, target)
		require.NoError(t, err)
		requireUsersNotFound(t, resp)
	})
}

// TestConsoleManagementBearerIgnoresStaleCookie pins the dual-scheme
// precedence: a valid project secret authorizes the request even when a stale
// or malformed session cookie rides along, instead of the cookie's failure
// turning it into a 401.
func TestConsoleManagementBearerIgnoresStaleCookie(t *testing.T) {
	t.Parallel()

	console := harness.EnsurePlatformProject(t)
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
		harness.EnsureTestServer(t).URL+"/teams?project_id="+console.ID,
		strings.NewReader(`{"name":"`+helpers.TeamName()+`"}`))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+harness.ProjectSecret(t, console))
	req.AddCookie(&http.Cookie{Name: "__nextgen_session", Value: "stale-or-garbage"})

	resp, err := harness.EnsureHttpClient(t).Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusCreated, resp.StatusCode)
}

// requireUsersNotFound pins a refused users list to its not-found shape: 404
// user.not_found, the same answer as a project that does not exist.
func requireUsersNotFound(t *testing.T, resp api.QueryUsersRes) {
	t.Helper()
	require.IsType(t, &api.QueryUsersErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
	denied := resp.(*api.QueryUsersErrorResponseStatusCode)
	assert.Equal(t, http.StatusNotFound, denied.StatusCode)
	assert.True(t, denied.Response.IsUserNotFound(), helpers.MustMarshal(t, resp))
}
