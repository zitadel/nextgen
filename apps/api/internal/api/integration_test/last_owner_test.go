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

// Deleting a user is refused only when they are the last active member of a
// project's owning team, and the refused call leaves the user in place. Admin
// grants stay freely revocable. People and teams live in the platform project;
// the owning team and the grants sit on the customer project, which is the one
// the refusal names.
func TestLastProjectOwner(t *testing.T) {
	t.Parallel()

	t.Run("deleting the last member of an owning team is refused", func(t *testing.T) {
		t.Parallel()
		f := newLastOwnerFixture(t)
		userID := harness.CreateUserWithTeam(t, f.platform.ID)
		team := createLastOwnerTeam(t, f.platform.ID, userID)
		harness.SeedOwningTeam(t, f.customer.ID, team.ID)

		resp, err := f.platformClient.DeleteUserByID(t.Context(), api.DeleteUserByIDParams{UserID: api.UserID(userID)})
		require.NoError(t, err)
		conflict, ok := resp.(*api.DeleteUserByIDConflict)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assertLastOwner(t, conflict.Code, conflict.Message, conflict.Details, f.customer.ID)

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

	t.Run("an admin grant does not stand in for an owner", func(t *testing.T) {
		t.Parallel()
		f := newLastOwnerFixture(t)
		userID := harness.CreateUserWithTeam(t, f.platform.ID)
		team := createLastOwnerTeam(t, f.platform.ID, userID)
		harness.SeedOwningTeam(t, f.customer.ID, team.ID)
		createLastOwnerGrant(t, f.customerClient, f.customer.ID, userIDGrant(harness.CreateUserWithTeam(t, f.platform.ID), api.CreateGrantRequestRelationAdmin))

		resp, err := f.platformClient.DeleteUserByID(t.Context(), api.DeleteUserByIDParams{UserID: api.UserID(userID)})
		require.NoError(t, err)
		conflict, ok := resp.(*api.DeleteUserByIDConflict)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assertLastOwner(t, conflict.Code, conflict.Message, conflict.Details, f.customer.ID)
	})

	t.Run("the last admin grant stays revocable", func(t *testing.T) {
		t.Parallel()
		f := newLastOwnerFixture(t)
		userID := harness.CreateUserWithTeam(t, f.platform.ID)
		grantID := createLastOwnerGrant(t, f.customerClient, f.customer.ID, userIDGrant(userID, api.CreateGrantRequestRelationAdmin))

		resp, err := f.customerClient.DeleteGrant(t.Context(), api.DeleteGrantParams{
			ID:        grantID,
			ProjectID: api.ProjectID(f.customer.ID),
		})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteGrantNoContent{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("deleting the only admin grantee succeeds", func(t *testing.T) {
		t.Parallel()
		f := newLastOwnerFixture(t)
		userID := harness.CreateUserWithTeam(t, f.platform.ID)
		createLastOwnerGrant(t, f.customerClient, f.customer.ID, userIDGrant(userID, api.CreateGrantRequestRelationAdmin))

		resp, err := f.platformClient.DeleteUserByID(t.Context(), api.DeleteUserByIDParams{UserID: api.UserID(userID)})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteUserByIDNoContent{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("deleting an owning team stays team.owns_project", func(t *testing.T) {
		t.Parallel()
		f := newLastOwnerFixture(t)
		userID := harness.CreateUserWithTeam(t, f.platform.ID)
		team := createLastOwnerTeam(t, f.platform.ID, userID)
		harness.SeedOwningTeam(t, f.customer.ID, team.ID)

		resp, err := f.platformClient.DeleteTeam(t.Context(), api.DeleteTeamParams{TeamID: api.TeamID(team.ID)})
		require.NoError(t, err)
		conflict, ok := resp.(*api.DeleteTeamConflict)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("team.owns_project"), conflict.Code)
	})
}

type lastOwnerFixture struct {
	platform       *domain.Project
	customer       *domain.Project
	platformClient *helpers.ApiClient
	customerClient *helpers.ApiClient
}

func newLastOwnerFixture(t *testing.T) lastOwnerFixture {
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
	return lastOwnerFixture{
		platform:       platform,
		customer:       customer,
		platformClient: platformClient,
		customerClient: customerClient,
	}
}

func createLastOwnerTeam(t *testing.T, projectID string, members ...string) *domain.Team {
	t.Helper()
	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: projectID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)
	for _, member := range members {
		require.NoError(t, harness.EnsureServiceDB(t).Statements().UpsertAuthzMembershipEdge(
			t.Context(), domain.NewUserTeamMembershipEdge(projectID, team.ID, member)))
	}
	return team
}

func createLastOwnerGrant(t *testing.T, client *helpers.ApiClient, projectID string, req *api.CreateGrantRequest) string {
	t.Helper()
	resp, err := client.CreateGrant(t.Context(), req, api.CreateGrantParams{ProjectID: api.ProjectID(projectID)})
	require.NoError(t, err)
	grant, ok := resp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, resp))
	return grant.ID
}

func assertLastOwner(t *testing.T, code api.ErrorCode, message string, details api.OptErrorDetailsDetails, projectIDs ...string) {
	t.Helper()
	assert.Equal(t, api.ErrorCode("proj.last_owner"), code)
	assert.Contains(t, message, "Add another member to that team")
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
