//go:build postgres_integration || spanner_integration

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

// A change is refused only when it would leave a project with nobody who can
// administer it, and the refused call leaves the row in place. People and
// teams live in the platform project; the grants and the owning team sit on
// the customer project, which is the one the refusal names.
func TestLastProjectAdmin(t *testing.T) {
	t.Parallel()

	t.Run("revoking the last admin grant is refused", func(t *testing.T) {
		t.Parallel()
		f := newLastAdminFixture(t)
		userID := harness.CreateUserWithTeam(t, f.platform.ID)
		grantID := createAdminGrant(t, f.customerClient, f.customer.ID, userIDGrant(userID, api.CreateGrantRequestRelationAdmin))

		resp, err := f.customerClient.DeleteGrant(t.Context(), api.DeleteGrantParams{
			ID:        grantID,
			ProjectID: api.ProjectID(f.customer.ID),
		})
		require.NoError(t, err)
		conflict, ok := resp.(*api.DeleteGrantConflict)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assertLastAdmin(t, conflict.Code, conflict.Message, conflict.Details, f.customer.ID)

		got, err := f.customerClient.GetGrant(t.Context(), api.GetGrantParams{
			ID:        grantID,
			ProjectID: api.ProjectID(f.customer.ID),
		})
		require.NoError(t, err)
		require.IsType(t, &api.Grant{}, got, helpers.MustMarshal(t, got))
	})

	t.Run("revoking an admin grant succeeds when someone else remains", func(t *testing.T) {
		t.Parallel()
		f := newLastAdminFixture(t)
		first := harness.CreateUserWithTeam(t, f.platform.ID)
		second := harness.CreateUserWithTeam(t, f.platform.ID)
		grantID := createAdminGrant(t, f.customerClient, f.customer.ID, userIDGrant(first, api.CreateGrantRequestRelationAdmin))
		createAdminGrant(t, f.customerClient, f.customer.ID, userIDGrant(second, api.CreateGrantRequestRelationAdmin))

		resp, err := f.customerClient.DeleteGrant(t.Context(), api.DeleteGrantParams{
			ID:        grantID,
			ProjectID: api.ProjectID(f.customer.ID),
		})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteGrantNoContent{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("revoking a viewer grant is unchanged", func(t *testing.T) {
		t.Parallel()
		f := newLastAdminFixture(t)
		userID := harness.CreateUserWithTeam(t, f.platform.ID)
		grantID := createAdminGrant(t, f.customerClient, f.customer.ID, userIDGrant(userID, api.CreateGrantRequestRelationViewer))

		resp, err := f.customerClient.DeleteGrant(t.Context(), api.DeleteGrantParams{
			ID:        grantID,
			ProjectID: api.ProjectID(f.customer.ID),
		})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteGrantNoContent{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("deleting the last admin user is refused", func(t *testing.T) {
		t.Parallel()
		f := newLastAdminFixture(t)
		userID := harness.CreateUserWithTeam(t, f.platform.ID)
		createAdminGrant(t, f.customerClient, f.customer.ID, userIDGrant(userID, api.CreateGrantRequestRelationAdmin))

		resp, err := f.platformClient.DeleteUserByID(t.Context(), api.DeleteUserByIDParams{UserID: api.UserID(userID)})
		require.NoError(t, err)
		conflict, ok := resp.(*api.DeleteUserByIDConflict)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assertLastAdmin(t, conflict.Code, conflict.Message, conflict.Details, f.customer.ID)

		got, err := f.platformClient.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(userID)})
		require.NoError(t, err)
		require.IsType(t, &api.User{}, got, helpers.MustMarshal(t, got))
	})

	t.Run("deleting an admin user succeeds when someone else remains", func(t *testing.T) {
		t.Parallel()
		f := newLastAdminFixture(t)
		first := harness.CreateUserWithTeam(t, f.platform.ID)
		second := harness.CreateUserWithTeam(t, f.platform.ID)
		createAdminGrant(t, f.customerClient, f.customer.ID, userIDGrant(first, api.CreateGrantRequestRelationAdmin))
		createAdminGrant(t, f.customerClient, f.customer.ID, userIDGrant(second, api.CreateGrantRequestRelationAdmin))

		resp, err := f.platformClient.DeleteUserByID(t.Context(), api.DeleteUserByIDParams{UserID: api.UserID(first)})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteUserByIDNoContent{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("deleting the last member of an owning team is refused", func(t *testing.T) {
		t.Parallel()
		f := newLastAdminFixture(t)
		userID := harness.CreateUserWithTeam(t, f.platform.ID)
		team := createLastAdminTeam(t, f.platform.ID)
		require.NoError(t, harness.EnsureServiceDB(t).Statements().UpsertAuthzMembershipEdge(
			t.Context(), domain.NewUserTeamMembershipEdge(f.platform.ID, team.ID, userID)))
		harness.SeedOwningTeam(t, f.customer.ID, team.ID)

		resp, err := f.platformClient.DeleteUserByID(t.Context(), api.DeleteUserByIDParams{UserID: api.UserID(userID)})
		require.NoError(t, err)
		conflict, ok := resp.(*api.DeleteUserByIDConflict)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assertLastAdmin(t, conflict.Code, conflict.Message, conflict.Details, f.customer.ID)

		got, err := f.platformClient.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(userID)})
		require.NoError(t, err)
		require.IsType(t, &api.User{}, got, helpers.MustMarshal(t, got))

		other := harness.CreateUserWithTeam(t, f.platform.ID)
		require.NoError(t, harness.EnsureServiceDB(t).Statements().UpsertAuthzMembershipEdge(
			t.Context(), domain.NewUserTeamMembershipEdge(f.platform.ID, team.ID, other)))
		resp, err = f.platformClient.DeleteUserByID(t.Context(), api.DeleteUserByIDParams{UserID: api.UserID(userID)})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteUserByIDNoContent{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("deleting a non-owning admin team is refused", func(t *testing.T) {
		t.Parallel()
		f := newLastAdminFixture(t)
		userID := harness.CreateUserWithTeam(t, f.platform.ID)
		team := createLastAdminTeam(t, f.platform.ID)
		require.NoError(t, harness.EnsureServiceDB(t).Statements().UpsertAuthzMembershipEdge(
			t.Context(), domain.NewUserTeamMembershipEdge(f.platform.ID, team.ID, userID)))
		createAdminGrant(t, f.customerClient, f.customer.ID, teamIDGrant(team.ID, api.CreateGrantRequestRelationAdmin))

		resp, err := f.platformClient.DeleteTeam(t.Context(), api.DeleteTeamParams{TeamID: api.TeamID(team.ID)})
		require.NoError(t, err)
		conflict, ok := resp.(*api.DeleteTeamConflict)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assertLastAdmin(t, conflict.Code, conflict.Message, conflict.Details, f.customer.ID)
		assert.Equal(t, api.TeamStatusActive, lastAdminTeamStatus(t, f.platformClient, team.ID))

		other := harness.CreateUserWithTeam(t, f.platform.ID)
		createAdminGrant(t, f.customerClient, f.customer.ID, userIDGrant(other, api.CreateGrantRequestRelationAdmin))
		resp, err = f.platformClient.DeleteTeam(t.Context(), api.DeleteTeamParams{TeamID: api.TeamID(team.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteTeamNoContent{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.TeamStatusDeactivated, lastAdminTeamStatus(t, f.platformClient, team.ID))
	})

	t.Run("deleting an owning team stays team.owns_project", func(t *testing.T) {
		t.Parallel()
		f := newLastAdminFixture(t)
		userID := harness.CreateUserWithTeam(t, f.platform.ID)
		team := createLastAdminTeam(t, f.platform.ID)
		require.NoError(t, harness.EnsureServiceDB(t).Statements().UpsertAuthzMembershipEdge(
			t.Context(), domain.NewUserTeamMembershipEdge(f.platform.ID, team.ID, userID)))
		harness.SeedOwningTeam(t, f.customer.ID, team.ID)

		resp, err := f.platformClient.DeleteTeam(t.Context(), api.DeleteTeamParams{TeamID: api.TeamID(team.ID)})
		require.NoError(t, err)
		conflict, ok := resp.(*api.DeleteTeamConflict)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("team.owns_project"), conflict.Code)
		assert.Equal(t, api.TeamStatusActive, lastAdminTeamStatus(t, f.platformClient, team.ID))
	})
}

type lastAdminFixture struct {
	platform       *domain.Project
	customer       *domain.Project
	platformClient *helpers.ApiClient
	customerClient *helpers.ApiClient
}

func newLastAdminFixture(t *testing.T) lastAdminFixture {
	t.Helper()
	platform := harness.EnsurePlatformProject(t)
	platformClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, platformClient, platform)

	customer, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	customerClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, customerClient, customer)
	return lastAdminFixture{
		platform:       platform,
		customer:       customer,
		platformClient: platformClient,
		customerClient: customerClient,
	}
}

func createLastAdminTeam(t *testing.T, projectID string) *domain.Team {
	t.Helper()
	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: projectID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)
	return team
}

func createAdminGrant(t *testing.T, client *helpers.ApiClient, projectID string, req *api.CreateGrantRequest) string {
	t.Helper()
	resp, err := client.CreateGrant(t.Context(), req, api.CreateGrantParams{ProjectID: api.ProjectID(projectID)})
	require.NoError(t, err)
	grant, ok := resp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, resp))
	return grant.ID
}

func lastAdminTeamStatus(t *testing.T, client *helpers.ApiClient, teamID string) api.TeamStatus {
	t.Helper()
	resp, err := client.GetTeam(t.Context(), api.GetTeamParams{TeamID: api.TeamID(teamID)})
	require.NoError(t, err)
	got, ok := resp.(*api.TeamResponse)
	require.True(t, ok, helpers.MustMarshal(t, resp))
	return got.Status
}

func assertLastAdmin(t *testing.T, code api.ErrorCode, message string, details api.OptErrorDetailsDetails, projectIDs ...string) {
	t.Helper()
	assert.Equal(t, api.ErrorCode("proj.last_admin"), code)
	assert.Contains(t, message, "Grant admin to someone else")
	for _, id := range projectIDs {
		assert.Contains(t, message, id)
	}
	require.True(t, details.IsSet())
	var body struct {
		ProjectIDs []string `json:"project_ids"`
	}
	require.NoError(t, json.Unmarshal(details.Value["details"], &body))
	assert.Equal(t, projectIDs, body.ProjectIDs)
}
