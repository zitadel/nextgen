//go:build postgres_integration || spanner_integration

package integration_test

import (
	"fmt"
	"slices"
	"testing"

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
// project neither reads nor writes there.
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
		require.IsNotType(t, &api.ListSchemasResponse{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("cannot list another project's flow definitions", func(t *testing.T) {
		resp, err := session.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{ProjectID: otherID})
		require.NoError(t, err)
		require.IsNotType(t, &api.FlowDefinitionListResponse{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("cannot list another project's branding", func(t *testing.T) {
		resp, err := session.ListBranding(t.Context(), api.ListBrandingParams{ProjectID: otherID})
		require.NoError(t, err)
		require.IsNotType(t, &api.ListBrandingResponse{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("cannot create a team in another project", func(t *testing.T) {
		resp, err := session.CreateTeam(t.Context(), &api.CreateTeamRequest{Name: helpers.TeamName()},
			api.CreateTeamParams{ProjectID: otherID})
		require.NoError(t, err)
		require.IsNotType(t, &api.TeamResponse{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("cannot read another project's user", func(t *testing.T) {
		foreignUserID, _ := harness.CreateUserOwnedByTeam(t, other.ID)
		resp, err := session.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(foreignUserID)})
		require.NoError(t, err)
		require.IsNotType(t, &api.User{}, resp, helpers.MustMarshal(t, resp))
	})
}

// TestConsoleSessionListsTargetProjectUsers pins #1300 §2: a platform
// operator signs in to the platform project and manages a customer project
// through a grant, so home and target differ. `project_id` on queryUsers names
// the target; without it the home project is listed, as before.
func TestConsoleSessionListsTargetProjectUsers(t *testing.T) {
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
		require.IsNotType(t, &api.QueryUsersResponse{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("without a grant the target is not listed", func(t *testing.T) {
		t.Parallel()
		strangerID, _ := harness.CreateUserOwnedByTeam(t, console.ID)
		stranger := sessionClientForUser(t, strangerID)
		resp, err := stranger.QueryUsers(t.Context(), &api.QueryUsersRequest{}, target)
		require.NoError(t, err)
		require.IsNotType(t, &api.QueryUsersResponse{}, resp, helpers.MustMarshal(t, resp))
	})
}

// TestConsoleSessionReadsTargetProjectByID pins #1300 §3: a platform operator
// opens a customer project's resources by id. The id is looked up across
// projects for a user principal, and the Check runs against the resource's own
// project — so the grant on the customer project is what allows it, and a
// caller without one still gets the not-found shape.
func TestConsoleSessionReadsTargetProjectByID(t *testing.T) {
	t.Parallel()

	console := harness.EnsurePlatformProject(t)
	operatorID, _ := harness.CreateUserOwnedByTeam(t, console.ID)

	customer, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	harness.SeedProjectAdmin(t, customer.ID, operatorID)
	customerUserID, customerTeamID := harness.CreateUserOwnedByTeam(t, customer.ID)

	customerSecret, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, customerSecret, customer)

	session := sessionClientForUser(t, operatorID)
	customerProjectID := api.ProjectID(customer.ID)

	t.Run("user", func(t *testing.T) {
		t.Parallel()
		resp, err := session.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(customerUserID)})
		require.NoError(t, err)
		require.IsType(t, &api.User{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("team read and update", func(t *testing.T) {
		t.Parallel()
		resp, err := session.GetTeam(t.Context(), api.GetTeamParams{TeamID: api.TeamID(customerTeamID)})
		require.NoError(t, err)
		require.IsType(t, &api.TeamResponse{}, resp, helpers.MustMarshal(t, resp))

		renamed := helpers.TeamName()
		updated, err := session.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: api.NewOptString(renamed)},
			api.UpdateTeamParams{TeamID: api.TeamID(customerTeamID)})
		require.NoError(t, err)
		got, ok := updated.(*api.TeamResponse)
		require.True(t, ok, helpers.MustMarshal(t, updated))
		require.Equal(t, renamed, got.Name)
	})

	t.Run("user delete", func(t *testing.T) {
		t.Parallel()
		doomedID, _ := harness.CreateUserOwnedByTeam(t, customer.ID)
		resp, err := session.DeleteUserByID(t.Context(), api.DeleteUserByIDParams{UserID: api.UserID(doomedID)})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteUserByIDNoContent{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("schema", func(t *testing.T) {
		t.Parallel()
		listed, err := session.ListSchemas(t.Context(), api.ListSchemasParams{ProjectID: customerProjectID})
		require.NoError(t, err)
		schemas, ok := listed.(*api.ListSchemasResponse)
		require.True(t, ok, helpers.MustMarshal(t, listed))
		require.NotEmpty(t, schemas.Schemas)

		// Schema ids are unique per project only (the seeded default carries
		// the same $id everywhere), so the session names the project.
		resp, err := session.GetSchemaById(t.Context(), api.GetSchemaByIdParams{
			ID:        schemas.Schemas[0].ID,
			ProjectID: api.NewOptProjectID(customerProjectID),
		})
		require.NoError(t, err)
		got, ok := resp.(*api.Schema)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		require.Equal(t, schemas.Schemas[0].ID, got.ID)
	})

	t.Run("flow definition", func(t *testing.T) {
		t.Parallel()
		listed, err := session.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{ProjectID: customerProjectID})
		require.NoError(t, err)
		flows, ok := listed.(*api.FlowDefinitionListResponse)
		require.True(t, ok, helpers.MustMarshal(t, listed))
		require.NotEmpty(t, flows.FlowDefinitions)

		resp, err := session.GetFlowDefinition(t.Context(), api.GetFlowDefinitionParams{ID: flows.FlowDefinitions[0].ID})
		require.NoError(t, err)
		require.IsType(t, &api.FlowDefinitionResponse{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("branding", func(t *testing.T) {
		t.Parallel()
		created, err := customerSecret.CreateBranding(t.Context(), &api.Branding{
			Layout: api.NewOptBrandingLayout(api.BrandingLayoutSplit),
		}, api.CreateBrandingParams{ProjectID: customerProjectID})
		require.NoError(t, err)
		revision, ok := created.(*api.BrandingRevisionResponse)
		require.True(t, ok, helpers.MustMarshal(t, created))

		resp, err := session.GetBrandingById(t.Context(), api.GetBrandingByIdParams{ID: revision.ID})
		require.NoError(t, err)
		require.IsType(t, &api.BrandingRevisionResponse{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("without a grant the resource is not found", func(t *testing.T) {
		t.Parallel()
		strangerID, _ := harness.CreateUserOwnedByTeam(t, console.ID)
		stranger := sessionClientForUser(t, strangerID)

		user, err := stranger.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(customerUserID)})
		require.NoError(t, err)
		require.IsType(t, &api.GetUserByIDNotFound{}, user, helpers.MustMarshal(t, user))

		team, err := stranger.GetTeam(t.Context(), api.GetTeamParams{TeamID: api.TeamID(customerTeamID)})
		require.NoError(t, err)
		require.IsType(t, &api.GetTeamNotFound{}, team, helpers.MustMarshal(t, team))
	})

	// The cross-project lookup is for user principals only: a project secret
	// still resolves ids in its own project, so another project's user is the
	// same not-found as before.
	t.Run("a project secret stays bound to its own project", func(t *testing.T) {
		t.Parallel()
		secret, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, secret, console)

		resp, err := secret.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(customerUserID)})
		require.NoError(t, err)
		require.IsType(t, &api.GetUserByIDNotFound{}, resp, helpers.MustMarshal(t, resp))
	})
}

// TestConsoleSessionExpandsUserTeams pins #1300 §4 (relaxed): a session mints
// no scopes, so the team_membership.read / team.read ceilings on
// queryUsers' expansions let a user principal through once it has passed the
// Check on the target project. The Console's Team column depends on it.
func TestConsoleSessionExpandsUserTeams(t *testing.T) {
	t.Parallel()

	console := harness.EnsurePlatformProject(t)
	operatorID, _ := harness.CreateUserOwnedByTeam(t, console.ID)

	customer, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	harness.SeedProjectAdmin(t, customer.ID, operatorID)
	memberID := harness.CreateUserWithTeam(t, customer.ID)

	session := sessionClientForUser(t, operatorID)
	resp, err := session.QueryUsers(t.Context(), &api.QueryUsersRequest{
		Expand: []api.UserExpand{api.UserExpandTeams, api.UserExpandLifecycleOwnerTeam},
	}, api.QueryUsersParams{ProjectID: api.NewOptProjectID(api.ProjectID(customer.ID))})
	require.NoError(t, err)
	listed, ok := resp.(*api.QueryUsersResponse)
	require.True(t, ok, helpers.MustMarshal(t, resp))

	var member *api.User
	for i := range listed.Users {
		if userID(t, listed.Users[i]) == memberID {
			member = &listed.Users[i]
		}
	}
	require.NotNil(t, member, helpers.MustMarshal(t, listed))
	require.NotEmpty(t, member.Teams, "the expansion must embed the member's team")
}
