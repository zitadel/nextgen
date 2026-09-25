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
