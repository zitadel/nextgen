//go:build postgres_integration || spanner_integration

package integration_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// TestProjectAdminsThroughOwningTeam covers #1462: the person who owns a
// project through its owning team is listed as an admin, an explicit grant to
// them adds a source instead of a second row, and revoking that grant leaves
// the inherited access in place.
func TestProjectAdminsThroughOwningTeam(t *testing.T) {
	t.Parallel()

	platform := harness.EnsurePlatformProject(t)
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	// The local journey's shape: the claimer's team owns the project.
	ownerID, owningTeamID := harness.CreateUserOwnedByTeam(t, platform.ID)
	harness.SeedOwningTeam(t, project.ID, owningTeamID)

	owner, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	owner.SetSessionToken(platformSessionCookie(t, ownerID).Value)

	projectParams := api.GetProjectParams{ProjectID: api.ProjectID(project.ID)}
	adminParams := api.ListProjectAdminsParams{ProjectID: api.ProjectID(project.ID)}
	grantParams := api.CreateGrantParams{ProjectID: api.ProjectID(project.ID)}

	queryAdmins := func(t *testing.T, client *helpers.ApiClient) map[api.UserID]api.ProjectAdmin {
		t.Helper()
		resp, err := client.ListProjectAdmins(t.Context(), adminParams)
		require.NoError(t, err)
		listed, ok := resp.(*api.ListProjectAdminsResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.False(t, listed.Truncated)
		out := make(map[api.UserID]api.ProjectAdmin, len(listed.Admins))
		for _, admin := range listed.Admins {
			require.NotContains(t, out, admin.User.UserID, "a person is listed once")
			out[admin.User.UserID] = admin
		}
		return out
	}
	sourceTypes := func(admin api.ProjectAdmin) []api.ProjectAdminSourceType {
		types := make([]api.ProjectAdminSourceType, 0, len(admin.Sources))
		for _, source := range admin.Sources {
			types = append(types, source.Type)
		}
		return types
	}

	getResp, err := owner.GetProject(t.Context(), projectParams)
	require.NoError(t, err)
	got, ok := getResp.(*api.ProjectDetailResponse)
	require.True(t, ok, helpers.MustMarshal(t, getResp))
	assert.Equal(t, api.TeamID(owningTeamID), got.OwningTeamID.Or(""), "the project names its owning team")

	admins := queryAdmins(t, owner)
	require.Contains(t, admins, api.UserID(ownerID), "the owner is an admin with no grant of their own")
	ownerRow := admins[api.UserID(ownerID)]
	assert.Equal(t, []api.ProjectAdminSourceType{api.ProjectAdminSourceTypeOwningTeam}, sourceTypes(ownerRow))
	require.True(t, ownerRow.Sources[0].Team.IsSet())
	assert.Equal(t, owningTeamID, ownerRow.Sources[0].Team.Value.TeamID)
	assert.True(t, ownerRow.Sources[0].Team.Value.Name.IsSet(), "the source names the team")
	assert.False(t, ownerRow.Sources[0].GrantID.IsSet(), "owning-team access is not a grant")
	assert.True(t, ownerRow.User.Identifier.IsSet(), "the row is a resolved user-ref")

	// A granted colleague and a viewer.
	colleagueID := harness.CreateUserWithTeam(t, platform.ID)
	viewerID := harness.CreateUserWithTeam(t, platform.ID)
	for _, grant := range []*api.CreateGrantRequest{
		userIDGrant(colleagueID, api.CreateGrantRequestRelationAdmin),
		userIDGrant(viewerID, api.CreateGrantRequestRelationViewer),
	} {
		resp, err := owner.CreateGrant(t.Context(), grant, grantParams)
		require.NoError(t, err)
		require.IsType(t, &api.Grant{}, resp, helpers.MustMarshal(t, resp))
	}
	// An explicit admin grant to the owner as well. Nobody may grant
	// themselves, so the project secret issues it.
	secret, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, secret, project)
	ownGrantResp, err := secret.CreateGrant(t.Context(), userIDGrant(ownerID, api.CreateGrantRequestRelationAdmin), grantParams)
	require.NoError(t, err)
	ownGrant, ok := ownGrantResp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, ownGrantResp))

	admins = queryAdmins(t, owner)
	assert.NotContains(t, admins, api.UserID(viewerID), "a viewer grant does not make an admin")
	require.Contains(t, admins, api.UserID(colleagueID))
	colleagueRow := admins[api.UserID(colleagueID)]
	assert.Equal(t, []api.ProjectAdminSourceType{api.ProjectAdminSourceTypeGrant}, sourceTypes(colleagueRow))
	assert.False(t, colleagueRow.Sources[0].Team.IsSet(), "a direct grant names no team")
	ownerRow = admins[api.UserID(ownerID)]
	assert.Equal(t, []api.ProjectAdminSourceType{api.ProjectAdminSourceTypeOwningTeam, api.ProjectAdminSourceTypeGrant}, sourceTypes(ownerRow),
		"both sources on one row, owning team first")
	assert.Equal(t, ownGrant.ID, ownerRow.Sources[1].GrantID.Or(""))

	// Revoking the explicit grant leaves the access inherited through the team.
	delResp, err := owner.DeleteGrant(t.Context(), api.DeleteGrantParams{ID: ownGrant.ID, ProjectID: api.ProjectID(project.ID)})
	require.NoError(t, err)
	require.IsType(t, &api.DeleteGrantNoContent{}, delResp, helpers.MustMarshal(t, delResp))
	admins = queryAdmins(t, owner)
	assert.Equal(t, []api.ProjectAdminSourceType{api.ProjectAdminSourceTypeOwningTeam}, sourceTypes(admins[api.UserID(ownerID)]))

	t.Run("only active members of the owning team are listed", func(t *testing.T) {
		// A membership write projects the edge the check reads; this does what
		// the team service does for each status.
		addMember := func(t *testing.T, userID string, status domain.MembershipStatus) {
			t.Helper()
			require.NoError(t, harness.EnsureTeamMembershipFixture(t).Create(t.Context(), &domain.TeamMembership{
				ProjectID: platform.ID, TeamID: owningTeamID, UserID: userID, Status: status,
			}))
			require.NoError(t, service.SyncUserTeamMembershipEdge(t.Context(), harness.EnsureServiceDB(t).Statements(),
				platform.ID, owningTeamID, userID, status))
		}
		activeID := harness.CreateUserWithTeam(t, platform.ID)
		addMember(t, activeID, domain.MembershipStatusActive)
		removedID := harness.CreateUserWithTeam(t, platform.ID)
		addMember(t, removedID, domain.MembershipStatusRemoved)

		admins := queryAdmins(t, owner)
		assert.Contains(t, admins, api.UserID(activeID), "an active member of the owning team is an admin")
		assert.NotContains(t, admins, api.UserID(removedID), "a removed member no longer is")
	})

	t.Run("an expired admin grant is not listed", func(t *testing.T) {
		expiredID := harness.CreateUserWithTeam(t, platform.ID)
		expiredAt := time.Now().Add(-time.Hour)
		expired := &domain.AuthzAssignment{
			ProjectID:     project.ID,
			CatalogID:     domain.SystemCatalogID,
			PrincipalType: domain.AuthzPrincipalTypeUser,
			PrincipalID:   expiredID,
			ObjectType:    "project",
			Relation:      domain.AuthzRelationAdmin,
			ExpiresAt:     &expiredAt,
		}
		expired.ApplyScope(domain.NewProjectAssignmentScope())
		require.NoError(t, harness.EnsureServiceDB(t).Statements().CreateAuthzAssignment(t.Context(), expired))
		assert.NotContains(t, queryAdmins(t, owner), api.UserID(expiredID))
	})

	t.Run("project secret reads the same list", func(t *testing.T) {
		assert.Contains(t, queryAdmins(t, secret), api.UserID(ownerID))
	})

	t.Run("no foothold is not found", func(t *testing.T) {
		stranger, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		stranger.SetSessionToken(platformSessionCookie(t, harness.CreateUserWithTeam(t, platform.ID)).Value)
		resp, err := stranger.ListProjectAdmins(t.Context(), adminParams)
		require.NoError(t, err)
		notFound, ok := resp.(*api.ListProjectAdminsNotFound)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode(domain.ErrProjectNotFound().Code), notFound.Code)
	})
}

// TestProjectWithoutOwningTeam pins the null owning team of an unclaimed
// project.
func TestProjectWithoutOwningTeam(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	resp, err := client.GetProject(t.Context(), api.GetProjectParams{ProjectID: api.ProjectID(project.ID)})
	require.NoError(t, err)
	got, ok := resp.(*api.ProjectDetailResponse)
	require.True(t, ok, helpers.MustMarshal(t, resp))
	assert.True(t, got.OwningTeamID.IsNull())
}
