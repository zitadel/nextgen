//go:build postgres_integration || spanner_integration

package integration_test

import (
	"context"
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

	// Users and teams live in the shared platform project, outside the test's
	// own project, so the test removes them itself: each user is deleted and
	// the team created with them deactivated, as teams have no delete.
	cleanupPlatformUser := func(t *testing.T, userID string) string {
		t.Helper()
		t.Cleanup(func() {
			ctx := context.Background()
			stmts := harness.EnsureServiceDB(t).Statements()
			if membership, err := stmts.GetEarliestTeamMembership(ctx, platform.ID, userID); err == nil {
				_, _ = stmts.DeactivateTeam(ctx, platform.ID, membership.TeamID)
			}
			_ = stmts.DeleteUserByID(ctx, platform.ID, userID)
		})
		return userID
	}

	// The local journey's shape: the claimer's team owns the project.
	ownerID, owningTeamID := harness.CreateUserOwnedByTeam(t, platform.ID)
	cleanupPlatformUser(t, ownerID)
	harness.SeedOwningTeam(t, project.ID, owningTeamID)

	owner, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	owner.SetSessionToken(platformSessionCookie(t, ownerID).Value)

	projectParams := api.GetProjectParams{ProjectID: api.ProjectID(project.ID)}
	adminParams := api.ListProjectAdminsParams{ProjectID: api.ProjectID(project.ID)}
	grantParams := api.CreateGrantParams{ProjectID: api.ProjectID(project.ID)}

	// queryAdmins reads every page, two people at a time, so the tests below
	// also walk the pagination.
	queryAdmins := func(t *testing.T, client *helpers.ApiClient) map[api.UserID]api.ProjectAdmin {
		t.Helper()
		out := map[api.UserID]api.ProjectAdmin{}
		params := adminParams
		params.Limit = api.NewOptLimit(2)
		var last api.UserID
		for {
			resp, err := client.ListProjectAdmins(t.Context(), params)
			require.NoError(t, err)
			listed, ok := resp.(*api.ListProjectAdminsResponse)
			require.True(t, ok, helpers.MustMarshal(t, resp))
			require.LessOrEqual(t, len(listed.Admins), 2)
			for _, admin := range listed.Admins {
				require.NotContains(t, out, admin.User.UserID, "a person is listed once")
				require.Greater(t, admin.User.UserID, last, "ordered by user id across pages")
				last = admin.User.UserID
				out[admin.User.UserID] = admin
			}
			token, ok := listed.NextPageToken.Get()
			if !ok {
				return out
			}
			params.PageToken = api.NewOptPageToken(token)
		}
	}
	// teamOf is the team a source names: always for the owning team, and for a
	// grant to a team.
	teamOf := func(source api.ProjectAdminSource) api.TeamRef {
		if source.Type == api.ProjectAdminOwningTeamSourceProjectAdminSource {
			return source.ProjectAdminOwningTeamSource.Team
		}
		return source.ProjectAdminGrantSource.Team.Value
	}
	hasTeam := func(source api.ProjectAdminSource) bool {
		return source.Type == api.ProjectAdminOwningTeamSourceProjectAdminSource || source.ProjectAdminGrantSource.Team.IsSet()
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
	assert.Equal(t, []api.ProjectAdminSourceType{api.ProjectAdminOwningTeamSourceProjectAdminSource}, sourceTypes(ownerRow))
	require.True(t, hasTeam(ownerRow.Sources[0]))
	assert.Equal(t, owningTeamID, teamOf(ownerRow.Sources[0]).TeamID)
	assert.True(t, teamOf(ownerRow.Sources[0]).Name.IsSet(), "the source names the team")
	assert.Empty(t, ownerRow.Sources[0].ProjectAdminGrantSource.GrantID, "owning-team access is not a grant")
	assert.True(t, ownerRow.User.Identifier.IsSet(), "the row is a resolved user-ref")

	// A granted colleague, a viewer, an editor, and a team granted admin.
	colleagueID := cleanupPlatformUser(t, harness.CreateUserWithTeam(t, platform.ID))
	viewerID := cleanupPlatformUser(t, harness.CreateUserWithTeam(t, platform.ID))
	editorID := cleanupPlatformUser(t, harness.CreateUserWithTeam(t, platform.ID))
	teamMemberID, adminTeamID := harness.CreateUserOwnedByTeam(t, platform.ID)
	cleanupPlatformUser(t, teamMemberID)
	for _, grant := range []*api.CreateGrantRequest{
		userIDGrant(colleagueID, api.CreateGrantRequestRelationAdmin),
		userIDGrant(viewerID, api.CreateGrantRequestRelationViewer),
		userIDGrant(editorID, api.CreateGrantRequestRelationEditor),
		teamIDGrant(adminTeamID, api.CreateGrantRequestRelationAdmin),
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
	assert.NotContains(t, admins, api.UserID(editorID), "an editor grant does not make an admin")
	require.Contains(t, admins, api.UserID(colleagueID))
	colleagueRow := admins[api.UserID(colleagueID)]
	require.Equal(t, []api.ProjectAdminSourceType{api.ProjectAdminGrantSourceProjectAdminSource}, sourceTypes(colleagueRow))
	assert.False(t, hasTeam(colleagueRow.Sources[0]), "a direct grant names no team")
	assert.NotContains(t, admins, api.UserID(teamMemberID), "the owner is not in the granted team, so its members are left out")
	// The member sees themselves, through the team grant, with the team named.
	member, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	member.SetSessionToken(platformSessionCookie(t, teamMemberID).Value)
	asMember := queryAdmins(t, member)
	require.Contains(t, asMember, api.UserID(teamMemberID), "a member of a team granted admin is an admin")
	teamMemberRow := asMember[api.UserID(teamMemberID)]
	require.Equal(t, []api.ProjectAdminSourceType{api.ProjectAdminGrantSourceProjectAdminSource}, sourceTypes(teamMemberRow))
	require.True(t, hasTeam(teamMemberRow.Sources[0]), "a team grant names its team")
	assert.Equal(t, adminTeamID, teamOf(teamMemberRow.Sources[0]).TeamID)
	assert.True(t, teamOf(teamMemberRow.Sources[0]).Name.IsSet(), "the member's own team is named")
	assert.NotEmpty(t, teamMemberRow.Sources[0].ProjectAdminGrantSource.GrantID)
	require.Contains(t, admins, api.UserID(ownerID))
	ownerRow = admins[api.UserID(ownerID)]
	require.Equal(t, []api.ProjectAdminSourceType{api.ProjectAdminOwningTeamSourceProjectAdminSource, api.ProjectAdminGrantSourceProjectAdminSource}, sourceTypes(ownerRow),
		"both sources on one row, owning team first")
	assert.Equal(t, ownGrant.ID, ownerRow.Sources[1].ProjectAdminGrantSource.GrantID)

	// Revoking the explicit grant leaves the access inherited through the team.
	delResp, err := owner.DeleteGrant(t.Context(), api.DeleteGrantParams{ID: ownGrant.ID, ProjectID: api.ProjectID(project.ID)})
	require.NoError(t, err)
	require.IsType(t, &api.DeleteGrantNoContent{}, delResp, helpers.MustMarshal(t, delResp))
	admins = queryAdmins(t, owner)
	require.Contains(t, admins, api.UserID(ownerID))
	assert.Equal(t, []api.ProjectAdminSourceType{api.ProjectAdminOwningTeamSourceProjectAdminSource}, sourceTypes(admins[api.UserID(ownerID)]))

	t.Run("only active members of the owning team are listed", func(t *testing.T) {
		// Membership writes project the edge the check reads.
		memberID := cleanupPlatformUser(t, harness.CreateUserWithTeam(t, platform.ID))
		require.NoError(t, harness.EnsureTeamMembershipFixture(t).Create(t.Context(), &domain.TeamMembership{
			ProjectID: platform.ID, TeamID: owningTeamID, UserID: memberID, Status: domain.MembershipStatusActive,
		}))
		assert.Contains(t, queryAdmins(t, owner), api.UserID(memberID), "an active member of the owning team is an admin")

		require.NoError(t, harness.EnsureServiceDB(t).Statements().UpdateTeamMembershipStatus(t.Context(),
			platform.ID, owningTeamID, memberID, domain.MembershipStatusRemoved))
		assert.NotContains(t, queryAdmins(t, owner), api.UserID(memberID), "a member who left no longer is")
	})

	t.Run("an admin grant with a future expiry is listed", func(t *testing.T) {
		futureID := cleanupPlatformUser(t, harness.CreateUserWithTeam(t, platform.ID))
		expiresAt := time.Now().Add(time.Hour)
		future := &domain.AuthzAssignment{
			ProjectID:     project.ID,
			CatalogID:     domain.SystemCatalogID,
			PrincipalType: domain.AuthzPrincipalTypeUser,
			PrincipalID:   futureID,
			ObjectType:    "project",
			Relation:      "admin",
			ExpiresAt:     &expiresAt,
		}
		future.ApplyScope(domain.NewProjectAssignmentScope())
		require.NoError(t, harness.EnsureServiceDB(t).Statements().CreateAuthzAssignment(t.Context(), future))
		assert.Contains(t, queryAdmins(t, owner), api.UserID(futureID))
	})

	t.Run("a deleted user's leftover grant is not listed", func(t *testing.T) {
		deletedID := cleanupPlatformUser(t, harness.CreateUserWithTeam(t, platform.ID))
		resp, err := owner.CreateGrant(t.Context(), userIDGrant(deletedID, api.CreateGrantRequestRelationAdmin), grantParams)
		require.NoError(t, err)
		require.IsType(t, &api.Grant{}, resp, helpers.MustMarshal(t, resp))
		require.Contains(t, queryAdmins(t, owner), api.UserID(deletedID))

		// Deleting a user leaves their grants in place.
		require.NoError(t, harness.EnsureUserService(t).DeleteUser(t.Context(), service.DeleteUserInput{ProjectID: platform.ID, UserID: deletedID}))
		assert.NotContains(t, queryAdmins(t, owner), api.UserID(deletedID))
	})

	t.Run("a viewer sees only people with a grant or in their own teams", func(t *testing.T) {
		reader, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		reader.SetSessionToken(platformSessionCookie(t, viewerID).Value)

		admins := queryAdmins(t, reader)
		assert.NotContains(t, admins, api.UserID(teamMemberID), "a member of a team the viewer is not in is left out")
		assert.NotContains(t, admins, api.UserID(ownerID), "so is a member of the owning team")
		require.Contains(t, admins, api.UserID(colleagueID))
		assert.True(t, admins[api.UserID(colleagueID)].User.Identifier.IsSet(), "a direct grant shows the person")
	})

	t.Run("an expired admin grant is not listed", func(t *testing.T) {
		expiredID := cleanupPlatformUser(t, harness.CreateUserWithTeam(t, platform.ID))
		expiredAt := time.Now().Add(-time.Hour)
		expired := &domain.AuthzAssignment{
			ProjectID:     project.ID,
			CatalogID:     domain.SystemCatalogID,
			PrincipalType: domain.AuthzPrincipalTypeUser,
			PrincipalID:   expiredID,
			ObjectType:    "project",
			Relation:      "admin",
			ExpiresAt:     &expiredAt,
		}
		expired.ApplyScope(domain.NewProjectAssignmentScope())
		require.NoError(t, harness.EnsureServiceDB(t).Statements().CreateAuthzAssignment(t.Context(), expired))
		assert.NotContains(t, queryAdmins(t, owner), api.UserID(expiredID))
	})

	t.Run("a project secret sees only people with a grant of their own", func(t *testing.T) {
		admins := queryAdmins(t, secret)
		assert.Contains(t, admins, api.UserID(colleagueID))
		assert.NotContains(t, admins, api.UserID(ownerID), "a secret is in no team, so team members are left out")
	})

	t.Run("an invalid page token is refused", func(t *testing.T) {
		params := adminParams
		params.PageToken = api.NewOptPageToken("not-a-token")
		resp, err := owner.ListProjectAdmins(t.Context(), params)
		require.NoError(t, err)
		_, ok := resp.(*api.ListProjectAdminsBadRequest)
		assert.True(t, ok, helpers.MustMarshal(t, resp))
	})

	t.Run("no foothold is not found", func(t *testing.T) {
		stranger, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		stranger.SetSessionToken(platformSessionCookie(t, cleanupPlatformUser(t, harness.CreateUserWithTeam(t, platform.ID))).Value)
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
