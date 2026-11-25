//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	api "go.zitadel.com/zitadel/v5/api"
)

// TestProjectMembers covers #1462: the person who owns a project through its
// owning team is listed as an admin, an explicit grant to them adds a source
// instead of a second row, and revoking that grant leaves the inherited access
// in place.
func TestProjectMembers(t *testing.T) {
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
	memberParams := api.ListProjectMembersParams{ProjectID: api.ProjectID(project.ID)}
	grantParams := api.CreateGrantParams{ProjectID: api.ProjectID(project.ID)}
	adminRelation := api.NewOptListProjectMembersRelation(api.ListProjectMembersRelationAdmin)

	// queryMembers reads every page, two people at a time, so the tests below
	// also walk the pagination.
	queryMembers := func(t *testing.T, client *helpers.ApiClient, relation api.OptListProjectMembersRelation) map[api.UserID]api.ProjectMember {
		t.Helper()
		out := map[api.UserID]api.ProjectMember{}
		params := memberParams
		params.Relation = relation
		params.Limit = api.NewOptLimit(2)
		var last api.UserID
		for {
			resp, err := client.ListProjectMembers(t.Context(), params)
			require.NoError(t, err)
			listed, ok := resp.(*api.ListProjectMembersResponse)
			require.True(t, ok, helpers.MustMarshal(t, resp))
			require.LessOrEqual(t, len(listed.Members), 2)
			for _, member := range listed.Members {
				require.NotContains(t, out, member.User.UserID, "a person is listed once")
				require.Greater(t, member.User.UserID, last, "ordered by user id across pages")
				last = member.User.UserID
				out[member.User.UserID] = member
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
	teamOf := func(source api.ProjectMemberSource) api.TeamRef {
		if source.Type == api.ProjectMemberOwningTeamSourceProjectMemberSource {
			return source.ProjectMemberOwningTeamSource.Team
		}
		return source.ProjectMemberGrantSource.Team.Value
	}
	hasTeam := func(source api.ProjectMemberSource) bool {
		return source.Type == api.ProjectMemberOwningTeamSourceProjectMemberSource || source.ProjectMemberGrantSource.Team.IsSet()
	}
	sourceTypes := func(member api.ProjectMember) []api.ProjectMemberSourceType {
		types := make([]api.ProjectMemberSourceType, 0, len(member.Sources))
		for _, source := range member.Sources {
			types = append(types, source.Type)
		}
		return types
	}

	getResp, err := owner.GetProject(t.Context(), projectParams)
	require.NoError(t, err)
	got, ok := getResp.(*api.ProjectDetailResponse)
	require.True(t, ok, helpers.MustMarshal(t, getResp))
	assert.Equal(t, api.TeamID(owningTeamID), got.OwningTeamID.Or(""), "the project names its owning team")

	admins := queryMembers(t, owner, adminRelation)
	require.Contains(t, admins, api.UserID(ownerID), "the owner is an admin with no grant of their own")
	ownerRow := admins[api.UserID(ownerID)]
	assert.Equal(t, api.ProjectMemberRelationAdmin, ownerRow.Relation)
	assert.Equal(t, []api.ProjectMemberSourceType{api.ProjectMemberOwningTeamSourceProjectMemberSource}, sourceTypes(ownerRow))
	require.True(t, hasTeam(ownerRow.Sources[0]))
	assert.Equal(t, owningTeamID, teamOf(ownerRow.Sources[0]).TeamID)
	assert.True(t, teamOf(ownerRow.Sources[0]).Name.IsSet(), "the source names the team")
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

	admins = queryMembers(t, owner, adminRelation)
	assert.NotContains(t, admins, api.UserID(viewerID), "a viewer grant does not make an admin")
	assert.NotContains(t, admins, api.UserID(editorID), "an editor grant does not make an admin")
	require.Contains(t, admins, api.UserID(colleagueID))
	colleagueRow := admins[api.UserID(colleagueID)]
	require.Equal(t, []api.ProjectMemberSourceType{api.ProjectMemberGrantSourceProjectMemberSource}, sourceTypes(colleagueRow))
	assert.False(t, hasTeam(colleagueRow.Sources[0]), "a direct grant names no team")
	// The owner is not in the granted team, and still sees its members, with
	// the team named.
	require.Contains(t, admins, api.UserID(teamMemberID), "a member of a team granted admin is an admin")
	teamMemberRow := admins[api.UserID(teamMemberID)]
	require.Equal(t, []api.ProjectMemberSourceType{api.ProjectMemberGrantSourceProjectMemberSource}, sourceTypes(teamMemberRow))
	require.True(t, hasTeam(teamMemberRow.Sources[0]), "a team grant names its team")
	assert.Equal(t, adminTeamID, teamOf(teamMemberRow.Sources[0]).TeamID)
	assert.True(t, teamOf(teamMemberRow.Sources[0]).Name.IsSet(), "a team the caller is not in is named too")
	assert.NotEmpty(t, teamMemberRow.Sources[0].ProjectMemberGrantSource.GrantID)
	require.Contains(t, admins, api.UserID(ownerID))
	ownerRow = admins[api.UserID(ownerID)]
	require.Equal(t, []api.ProjectMemberSourceType{api.ProjectMemberOwningTeamSourceProjectMemberSource, api.ProjectMemberGrantSourceProjectMemberSource}, sourceTypes(ownerRow),
		"both sources on one row, owning team first")
	assert.Equal(t, ownGrant.ID, ownerRow.Sources[1].ProjectMemberGrantSource.GrantID)

	// Revoking the explicit grant leaves the access inherited through the team.
	delResp, err := owner.DeleteGrant(t.Context(), api.DeleteGrantParams{GrantID: ownGrant.ID, ProjectID: api.ProjectID(project.ID)})
	require.NoError(t, err)
	require.IsType(t, &api.DeleteGrantNoContent{}, delResp, helpers.MustMarshal(t, delResp))
	admins = queryMembers(t, owner, adminRelation)
	require.Contains(t, admins, api.UserID(ownerID))
	assert.Equal(t, []api.ProjectMemberSourceType{api.ProjectMemberOwningTeamSourceProjectMemberSource}, sourceTypes(admins[api.UserID(ownerID)]))

	t.Run("only active members of the owning team are listed", func(t *testing.T) {
		// Membership writes project the edge the check reads.
		memberID := cleanupPlatformUser(t, harness.CreateUserWithTeam(t, platform.ID))
		require.NoError(t, harness.EnsureTeamMembershipFixture(t).Create(t.Context(), &domain.TeamMembership{
			ProjectID: platform.ID, TeamID: owningTeamID, UserID: memberID, Status: domain.MembershipStatusActive,
		}))
		assert.Contains(t, queryMembers(t, owner, adminRelation), api.UserID(memberID), "an active member of the owning team is an admin")

		require.NoError(t, harness.EnsureServiceDB(t).Statements().UpdateTeamMembershipStatus(t.Context(),
			platform.ID, owningTeamID, memberID, domain.MembershipStatusRemoved))
		assert.NotContains(t, queryMembers(t, owner, api.OptListProjectMembersRelation{}), api.UserID(memberID), "a member who left no longer is")
	})

	// #2656: an admin added by a direct grant sees the owners.
	t.Run("every caller sees every member", func(t *testing.T) {
		colleague, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		colleague.SetSessionToken(platformSessionCookie(t, colleagueID).Value)
		reader, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		reader.SetSessionToken(platformSessionCookie(t, viewerID).Value)

		want := queryMembers(t, owner, api.OptListProjectMembersRelation{})
		for name, client := range map[string]*helpers.ApiClient{"a direct admin": colleague, "a viewer": reader, "a project secret": secret} {
			got := queryMembers(t, client, api.OptListProjectMembersRelation{})
			assert.Equal(t, want, got, "%s sees what the owner sees", name)
		}
	})

	t.Run("each member has their strongest role", func(t *testing.T) {
		members := queryMembers(t, owner, api.OptListProjectMembersRelation{})
		for userID, want := range map[string]api.ProjectMemberRelation{
			ownerID:     api.ProjectMemberRelationAdmin,
			colleagueID: api.ProjectMemberRelationAdmin,
			editorID:    api.ProjectMemberRelationEditor,
			viewerID:    api.ProjectMemberRelationViewer,
		} {
			require.Contains(t, members, api.UserID(userID))
			assert.Equal(t, want, members[api.UserID(userID)].Relation)
		}

		editors := queryMembers(t, owner, api.NewOptListProjectMembersRelation(api.ListProjectMembersRelationEditor))
		assert.Contains(t, editors, api.UserID(editorID))
		assert.Contains(t, editors, api.UserID(colleagueID), "an admin is at least an editor")
		assert.NotContains(t, editors, api.UserID(viewerID))
	})

	t.Run("an invalid page token is refused", func(t *testing.T) {
		params := memberParams
		params.PageToken = api.NewOptPageToken("not-a-token")
		resp, err := owner.ListProjectMembers(t.Context(), params)
		require.NoError(t, err)
		_, ok := resp.(*api.ListProjectMembersBadRequest)
		assert.True(t, ok, helpers.MustMarshal(t, resp))
	})

	t.Run("no foothold is not found", func(t *testing.T) {
		stranger, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		stranger.SetSessionToken(platformSessionCookie(t, cleanupPlatformUser(t, harness.CreateUserWithTeam(t, platform.ID))).Value)
		resp, err := stranger.ListProjectMembers(t.Context(), memberParams)
		require.NoError(t, err)
		notFound, ok := resp.(*api.ListProjectMembersNotFound)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode(domain.ErrProjectNotFound().Code), notFound.Code)
	})
}
