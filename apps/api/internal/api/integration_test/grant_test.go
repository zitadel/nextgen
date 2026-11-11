//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	api "go.zitadel.com/zitadel/v5/api"
)

func userIDGrant(userID string, rel api.CreateGrantRequestRelation) *api.CreateGrantRequest {
	return &api.CreateGrantRequest{
		Relation: rel,
		User: api.NewOptUserLocator(api.UserLocator{
			UserID: api.NewOptUserID(api.UserID(userID)),
		}),
	}
}

func teamIDGrant(teamID string, rel api.CreateGrantRequestRelation) *api.CreateGrantRequest {
	return &api.CreateGrantRequest{
		Relation: rel,
		Team: api.NewOptTeamLocator(api.TeamLocator{
			TeamID: api.NewOptTeamID(api.TeamID(teamID)),
		}),
	}
}

func userIdentifierGrant(identifier string, rel api.CreateGrantRequestRelation) *api.CreateGrantRequest {
	return &api.CreateGrantRequest{
		Relation: rel,
		User: api.NewOptUserLocator(api.UserLocator{
			Identifier: api.NewOptString(identifier),
		}),
	}
}

func teamNameGrant(name string, rel api.CreateGrantRequestRelation) *api.CreateGrantRequest {
	return &api.CreateGrantRequest{
		Relation: rel,
		Team: api.NewOptTeamLocator(api.TeamLocator{
			Name: api.NewOptString(name),
		}),
	}
}

func TestGrantCreateGetRevoke(t *testing.T) {
	t.Parallel()

	platform := harness.EnsurePlatformProject(t)
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	claimProject(t, project.ID)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	params := func() api.CreateGrantParams {
		return api.CreateGrantParams{ProjectID: api.ProjectID(project.ID)}
	}

	t.Run("user grant happy path", func(t *testing.T) {
		t.Parallel()

		userID := harness.CreateUserWithTeam(t, platform.ID)
		createResp, err := client.CreateGrant(t.Context(), userIDGrant(userID, api.CreateGrantRequestRelationViewer), params())
		require.NoError(t, err)
		created, ok := createResp.(*api.Grant)
		require.True(t, ok, helpers.MustMarshal(t, createResp))
		assert.True(t, strings.HasPrefix(created.ID, "asgn_"), created.ID)
		assert.Equal(t, project.ID, created.ProjectID)
		assert.Equal(t, api.GrantRelationViewer, created.Relation)
		assert.Equal(t, api.GrantObjectTypeProject, created.ObjectType)
		require.True(t, created.User.IsSet())
		assert.Equal(t, api.UserID(userID), created.User.Value.UserID)
		assert.False(t, created.User.Value.Identifier.IsSet())
		assert.False(t, created.User.Value.Display.IsSet())
		assert.False(t, created.Team.IsSet())
		assert.False(t, created.User.Value.Schema.IsSet())

		getResp, err := client.GetGrant(t.Context(), api.GetGrantParams{
			ID:        created.ID,
			ProjectID: api.ProjectID(project.ID),
		})
		require.NoError(t, err)
		got, ok := getResp.(*api.Grant)
		require.True(t, ok, helpers.MustMarshal(t, getResp))
		assert.Equal(t, created.ID, got.ID)
		require.True(t, got.User.IsSet())
		assert.True(t, got.User.Value.Identifier.IsSet())

		delResp, err := client.DeleteGrant(t.Context(), api.DeleteGrantParams{
			ID:        created.ID,
			ProjectID: api.ProjectID(project.ID),
		})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteGrantNoContent{}, delResp, helpers.MustMarshal(t, delResp))

		getAgain, err := client.GetGrant(t.Context(), api.GetGrantParams{
			ID:        created.ID,
			ProjectID: api.ProjectID(project.ID),
		})
		require.NoError(t, err)
		assertGrantNotFound(t, getAgain)
	})

	t.Run("team grant happy path", func(t *testing.T) {
		t.Parallel()

		team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
			ProjectID: platform.ID,
			Name:      helpers.TeamName(),
		})
		require.NoError(t, err)

		createResp, err := client.CreateGrant(t.Context(), teamIDGrant(team.ID, api.CreateGrantRequestRelationEditor), params())
		require.NoError(t, err)
		created, ok := createResp.(*api.Grant)
		require.True(t, ok, helpers.MustMarshal(t, createResp))
		assert.Equal(t, api.GrantRelationEditor, created.Relation)
		require.True(t, created.Team.IsSet())
		assert.Equal(t, team.ID, created.Team.Value.TeamID)
		assert.False(t, created.Team.Value.Name.IsSet())
		assert.False(t, created.User.IsSet())

		delResp, err := client.DeleteGrant(t.Context(), api.DeleteGrantParams{
			ID:        created.ID,
			ProjectID: api.ProjectID(project.ID),
		})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteGrantNoContent{}, delResp, helpers.MustMarshal(t, delResp))
	})

	t.Run("duplicate post is 409", func(t *testing.T) {
		t.Parallel()

		userID := harness.CreateUserWithTeam(t, platform.ID)
		req := userIDGrant(userID, api.CreateGrantRequestRelationAdmin)
		first, err := client.CreateGrant(t.Context(), req, params())
		require.NoError(t, err)
		require.IsType(t, &api.Grant{}, first, helpers.MustMarshal(t, first))

		second, err := client.CreateGrant(t.Context(), req, params())
		require.NoError(t, err)
		assertGrantAlreadyExists(t, second)
	})

	t.Run("foreign project secret is anti-oracle 404", func(t *testing.T) {
		t.Parallel()

		other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		foreign, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, foreign, other)

		userID := harness.CreateUserWithTeam(t, platform.ID)
		resp, err := foreign.CreateGrant(t.Context(), userIDGrant(userID, api.CreateGrantRequestRelationViewer), params())
		require.NoError(t, err)
		assertGrantNotFound(t, resp)
	})

	t.Run("revoke then re-create same binding", func(t *testing.T) {
		t.Parallel()

		userID := harness.CreateUserWithTeam(t, platform.ID)
		req := userIDGrant(userID, api.CreateGrantRequestRelationViewer)
		first, err := client.CreateGrant(t.Context(), req, params())
		require.NoError(t, err)
		created, ok := first.(*api.Grant)
		require.True(t, ok, helpers.MustMarshal(t, first))

		delResp, err := client.DeleteGrant(t.Context(), api.DeleteGrantParams{
			ID:        created.ID,
			ProjectID: api.ProjectID(project.ID),
		})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteGrantNoContent{}, delResp, helpers.MustMarshal(t, delResp))

		second, err := client.CreateGrant(t.Context(), req, params())
		require.NoError(t, err)
		recreated, ok := second.(*api.Grant)
		require.True(t, ok, helpers.MustMarshal(t, second))
		assert.NotEqual(t, created.ID, recreated.ID)
	})

	t.Run("setup assignment get and delete are not found", func(t *testing.T) {
		t.Parallel()

		stmts := harness.EnsureServiceDB(t).Statements()
		asgns, err := stmts.ListAuthzAssignments(t.Context(), project.ID, domain.AuthzPrincipalTypeSKProj, project.ID, false)
		require.NoError(t, err)
		require.NotEmpty(t, asgns, "CreateProject seeds sk_proj setup assignment")
		setupID := asgns[0].ID

		getResp, err := client.GetGrant(t.Context(), api.GetGrantParams{
			ID:        setupID,
			ProjectID: api.ProjectID(project.ID),
		})
		require.NoError(t, err)
		assertGrantNotFound(t, getResp)

		delResp, err := client.DeleteGrant(t.Context(), api.DeleteGrantParams{
			ID:        setupID,
			ProjectID: api.ProjectID(project.ID),
		})
		require.NoError(t, err)
		assertGrantNotFound(t, delResp)

		still, err := stmts.ListAuthzAssignments(t.Context(), project.ID, domain.AuthzPrincipalTypeSKProj, project.ID, false)
		require.NoError(t, err)
		require.NotEmpty(t, still)
		assert.Nil(t, still[0].RevokedAt)
	})

	t.Run("owning-team assignment get and delete are not found", func(t *testing.T) {
		t.Parallel()

		// The project's claim: claimProject wrote it.
		stmts := harness.EnsureServiceDB(t).Statements()
		asgn, err := stmts.GetActiveOwningTeamGrant(t.Context(), project.ID)
		require.NoError(t, err)

		getResp, err := client.GetGrant(t.Context(), api.GetGrantParams{
			ID:        asgn.ID,
			ProjectID: api.ProjectID(project.ID),
		})
		require.NoError(t, err)
		assertGrantNotFound(t, getResp)

		delResp, err := client.DeleteGrant(t.Context(), api.DeleteGrantParams{
			ID:        asgn.ID,
			ProjectID: api.ProjectID(project.ID),
		})
		require.NoError(t, err)
		assertGrantNotFound(t, delResp)

		owning, err := stmts.GetActiveOwningTeamGrant(t.Context(), project.ID)
		require.NoError(t, err)
		assert.Equal(t, asgn.ID, owning.ID)
		assert.Nil(t, owning.RevokedAt)
	})
}

func TestGrantCreateLocators(t *testing.T) {
	t.Parallel()

	platform := harness.EnsurePlatformProject(t)
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	claimProject(t, project.ID)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	platformClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, platformClient, platform)

	params := api.CreateGrantParams{ProjectID: api.ProjectID(project.ID)}

	t.Run("create by identifier", func(t *testing.T) {
		t.Parallel()
		userID := harness.CreateUserWithTeam(t, platform.ID)
		userResp, err := platformClient.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(userID)})
		require.NoError(t, err)
		user, ok := userResp.(*api.User)
		require.True(t, ok, helpers.MustMarshal(t, userResp))
		require.True(t, user.Identifier.IsSet())

		createResp, err := client.CreateGrant(t.Context(), userIdentifierGrant(strings.ToUpper(user.Identifier.Value), api.CreateGrantRequestRelationViewer), params)
		require.NoError(t, err)
		require.IsType(t, &api.CreateGrantAccepted{}, createResp, helpers.MustMarshal(t, createResp))

		// The 202 says nothing, so the row is proven through the list.
		listed := grantsForUser(t, client, project.ID, userID)
		require.Len(t, listed, 1)
		require.True(t, listed[0].User.IsSet())
		assert.Equal(t, api.UserID(userID), listed[0].User.Value.UserID)
		assert.True(t, listed[0].User.Value.Identifier.IsSet())
	})

	t.Run("create by team name", func(t *testing.T) {
		t.Parallel()
		team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
			ProjectID: platform.ID,
			Name:      helpers.TeamName(),
		})
		require.NoError(t, err)

		createResp, err := client.CreateGrant(t.Context(), teamNameGrant(strings.ToUpper(team.Name), api.CreateGrantRequestRelationAdmin), params)
		require.NoError(t, err)
		created, ok := createResp.(*api.Grant)
		require.True(t, ok, helpers.MustMarshal(t, createResp))
		require.True(t, created.Team.IsSet())
		assert.Equal(t, team.ID, created.Team.Value.TeamID)
		assert.False(t, created.Team.Value.Name.IsSet())
	})

	t.Run("unknown identifier is accepted without a row", func(t *testing.T) {
		t.Parallel()
		// Own project: sibling t.Parallel() creates on the shared project
		// would otherwise make a global QueryGrants length assertion race.
		isolated, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		claimProject(t, isolated.ID)
		isolatedClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, isolatedClient, isolated)
		isolatedParams := api.CreateGrantParams{ProjectID: api.ProjectID(isolated.ID)}

		before, err := isolatedClient.QueryGrants(t.Context(), &api.QueryGrantsRequest{}, api.QueryGrantsParams{ProjectID: api.ProjectID(isolated.ID)})
		require.NoError(t, err)
		listedBefore, ok := before.(*api.QueryGrantsResponse)
		require.True(t, ok, helpers.MustMarshal(t, before))

		resp, err := isolatedClient.CreateGrant(t.Context(), userIdentifierGrant("nobody@example.com", api.CreateGrantRequestRelationViewer), isolatedParams)
		require.NoError(t, err)
		require.IsType(t, &api.CreateGrantAccepted{}, resp, helpers.MustMarshal(t, resp))

		after, err := isolatedClient.QueryGrants(t.Context(), &api.QueryGrantsRequest{}, api.QueryGrantsParams{ProjectID: api.ProjectID(isolated.ID)})
		require.NoError(t, err)
		listedAfter, ok := after.(*api.QueryGrantsResponse)
		require.True(t, ok, helpers.MustMarshal(t, after))
		assert.Len(t, listedAfter.Grants, len(listedBefore.Grants))
	})

	t.Run("repeat identifier is accepted and writes nothing new", func(t *testing.T) {
		t.Parallel()
		userID := harness.CreateUserWithTeam(t, platform.ID)
		userResp, err := platformClient.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(userID)})
		require.NoError(t, err)
		user, ok := userResp.(*api.User)
		require.True(t, ok, helpers.MustMarshal(t, userResp))
		require.True(t, user.Identifier.IsSet())

		req := userIdentifierGrant(user.Identifier.Value, api.CreateGrantRequestRelationEditor)
		first, err := client.CreateGrant(t.Context(), req, params)
		require.NoError(t, err)
		require.IsType(t, &api.CreateGrantAccepted{}, first, helpers.MustMarshal(t, first))

		second, err := client.CreateGrant(t.Context(), req, params)
		require.NoError(t, err)
		require.IsType(t, &api.CreateGrantAccepted{}, second, helpers.MustMarshal(t, second))

		assert.Len(t, grantsForUser(t, client, project.ID, userID), 1)
	})

	t.Run("own identifier is grant.invalid", func(t *testing.T) {
		t.Parallel()
		userID := harness.CreateUserWithTeam(t, platform.ID)
		// Admin: the write check runs before validation, so a viewer would
		// be refused before the self-grant rule is ever reached.
		harness.SeedProjectAdmin(t, project.ID, userID)
		userResp, err := platformClient.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(userID)})
		require.NoError(t, err)
		user, ok := userResp.(*api.User)
		require.True(t, ok, helpers.MustMarshal(t, userResp))
		require.True(t, user.Identifier.IsSet())

		sessionClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		sessionClient.SetSessionToken(platformSessionCookie(t, userID).Value)

		resp, err := sessionClient.CreateGrant(t.Context(), userIdentifierGrant(user.Identifier.Value, api.CreateGrantRequestRelationAdmin), params)
		require.NoError(t, err)
		bad, ok := resp.(*api.CreateGrantBadRequest)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("grant.invalid"), bad.Code)
		assert.Equal(t, "you cannot grant access to yourself", bad.Message)
	})

	// A hit and a miss, each repeated, are the whole existence oracle: the
	// 202 has no body to compare and no id to replay through user_id.
	t.Run("identifier hit and miss are indistinguishable", func(t *testing.T) {
		t.Parallel()
		userID := harness.CreateUserWithTeam(t, platform.ID)
		userResp, err := platformClient.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(userID)})
		require.NoError(t, err)
		user, ok := userResp.(*api.User)
		require.True(t, ok, helpers.MustMarshal(t, userResp))
		require.True(t, user.Identifier.IsSet())

		unknown := helpers.RandString(10) + "@example.com"
		for _, identifier := range []string{user.Identifier.Value, unknown, user.Identifier.Value, unknown} {
			resp, err := client.CreateGrant(t.Context(), userIdentifierGrant(identifier, api.CreateGrantRequestRelationViewer), params)
			require.NoError(t, err)
			require.IsType(t, &api.CreateGrantAccepted{}, resp, helpers.MustMarshal(t, resp))
		}
	})

	t.Run("own user_id is grant.invalid", func(t *testing.T) {
		t.Parallel()
		userID := harness.CreateUserWithTeam(t, platform.ID)
		harness.SeedProjectAdmin(t, project.ID, userID)

		sessionClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		sessionClient.SetSessionToken(platformSessionCookie(t, userID).Value)

		resp, err := sessionClient.CreateGrant(t.Context(), userIDGrant(userID, api.CreateGrantRequestRelationAdmin), params)
		require.NoError(t, err)
		bad, ok := resp.(*api.CreateGrantBadRequest)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("grant.invalid"), bad.Code)
		assert.Equal(t, "you cannot grant access to yourself", bad.Message)
	})

	t.Run("unknown user_id is principal not found", func(t *testing.T) {
		t.Parallel()
		resp, err := client.CreateGrant(t.Context(), userIDGrant("user_01hzzzzzzzzzzzzzzzzzzzzzzz", api.CreateGrantRequestRelationViewer), params)
		require.NoError(t, err)
		assertGrantPrincipalNotFound(t, resp)
	})

	t.Run("duplicate user_id is already exists", func(t *testing.T) {
		t.Parallel()
		userID := harness.CreateUserWithTeam(t, platform.ID)
		req := userIDGrant(userID, api.CreateGrantRequestRelationViewer)
		first, err := client.CreateGrant(t.Context(), req, params)
		require.NoError(t, err)
		require.IsType(t, &api.Grant{}, first, helpers.MustMarshal(t, first))

		second, err := client.CreateGrant(t.Context(), req, params)
		require.NoError(t, err)
		assertGrantAlreadyExists(t, second)
	})

	t.Run("both user and team is invalid", func(t *testing.T) {
		t.Parallel()
		resp, err := client.CreateGrant(t.Context(), &api.CreateGrantRequest{
			Relation: api.CreateGrantRequestRelationViewer,
			User:     api.NewOptUserLocator(api.UserLocator{UserID: api.NewOptUserID("user_1")}),
			Team:     api.NewOptTeamLocator(api.TeamLocator{TeamID: api.NewOptTeamID("team_1")}),
		}, params)
		require.NoError(t, err)
		bad, ok := resp.(*api.CreateGrantBadRequest)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("grant.invalid"), bad.Code)
	})

	t.Run("extra user locator field is req.invalid", func(t *testing.T) {
		t.Parallel()
		assertCreateGrantReqInvalid(t, client.Token(), project.ID,
			`{"relation":"viewer","user":{"user_id":"user_1","extra":"nope"}}`)
	})

	t.Run("extra team locator field is req.invalid", func(t *testing.T) {
		t.Parallel()
		assertCreateGrantReqInvalid(t, client.Token(), project.ID,
			`{"relation":"admin","team":{"team_id":"team_1","extra":"nope"}}`)
	})
}

// grantsForUser lists a project's grants for one user. The identifier create
// answers 202 with no body, so the written row is only observable here.
func grantsForUser(t *testing.T, client *helpers.ApiClient, projectID, userID string) []api.Grant {
	t.Helper()
	listed, err := client.QueryGrants(t.Context(), &api.QueryGrantsRequest{
		Filter: []api.QueryGrantsRequestFilterItem{{
			Field:     api.GrantFilterFieldUserID,
			Operation: api.FilterOperationEquals,
			Value:     api.NewOptFilterValue(api.NewStringFilterValue(userID)),
		}},
	}, api.QueryGrantsParams{ProjectID: api.ProjectID(projectID)})
	require.NoError(t, err)
	page, ok := listed.(*api.QueryGrantsResponse)
	require.True(t, ok, helpers.MustMarshal(t, listed))
	return page.Grants
}

// claimProject gives the project an owning team from the platform project,
// as claim/complete does: a project needs one before it grants a platform
// user or team (ADR 054 §4 amendment).
func claimProject(t *testing.T, projectID string) {
	t.Helper()
	ownerID, teamID := harness.CreateUserOwnedByTeam(t, harness.EnsurePlatformProject(t).ID)
	cleanupPlatformUserAndTeam(t, ownerID)
	harness.SeedOwningTeam(t, projectID, teamID)
}

// cleanupPlatformUserAndTeam removes a user the test created in the shared
// platform project, outside the test's own project: the user is deleted and
// the team created with it deactivated, as teams have no delete.
func cleanupPlatformUserAndTeam(t *testing.T, userID string) {
	t.Helper()
	platformID := harness.EnsurePlatformProject(t).ID
	t.Cleanup(func() {
		ctx := context.Background()
		stmts := harness.EnsureServiceDB(t).Statements()
		if membership, err := stmts.GetEarliestTeamMembership(ctx, platformID, userID); err == nil {
			_, err = stmts.DeactivateTeam(ctx, platformID, membership.TeamID)
			assert.NoError(t, err)
		}
		_ = stmts.DeleteUserByID(ctx, platformID, userID)
	})
}

// platformReader signs in a platform user who may read the project's grants
// and the platform project's users: the caller expand=principal admits.
func platformReader(t *testing.T, projectID string) *helpers.ApiClient {
	t.Helper()
	platform := harness.EnsurePlatformProject(t)
	readerID := harness.CreateUserWithTeam(t, platform.ID)
	cleanupPlatformUserAndTeam(t, readerID)
	harness.SeedProjectViewer(t, projectID, readerID)
	platformViewer := harness.SeedProjectViewer(t, platform.ID, readerID)
	t.Cleanup(func() {
		_ = harness.EnsureServiceDB(t).Statements().RevokeAuthzAssignment(context.Background(), platform.ID, platformViewer.ID)
	})
	return sessionClientForUser(t, readerID)
}

func TestGrantQuery(t *testing.T) {
	t.Parallel()

	platform := harness.EnsurePlatformProject(t)
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	// The claim the grants below need, and a row the list must not show.
	stmts := harness.EnsureServiceDB(t).Statements()
	owningTeam, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: platform.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := stmts.DeactivateTeam(context.Background(), platform.ID, owningTeam.ID)
		assert.NoError(t, err)
	})
	owning := domain.NewClaimTeamAssignment(project.ID, owningTeam.ID)
	require.NoError(t, stmts.CreateAuthzAssignment(t.Context(), owning))

	params := api.QueryGrantsParams{ProjectID: api.ProjectID(project.ID)}
	getParams := func(id string) api.GetGrantParams {
		return api.GetGrantParams{ID: id, ProjectID: api.ProjectID(project.ID)}
	}

	userID := harness.CreateUserWithTeam(t, platform.ID)
	userGrantResp, err := client.CreateGrant(t.Context(), userIDGrant(userID, api.CreateGrantRequestRelationViewer), api.CreateGrantParams{ProjectID: api.ProjectID(project.ID)})
	require.NoError(t, err)
	userGrant, ok := userGrantResp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, userGrantResp))

	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: platform.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)
	teamGrantResp, err := client.CreateGrant(t.Context(), teamIDGrant(team.ID, api.CreateGrantRequestRelationEditor), api.CreateGrantParams{ProjectID: api.ProjectID(project.ID)})
	require.NoError(t, err)
	teamGrant, ok := teamGrantResp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, teamGrantResp))

	revokedUserID := harness.CreateUserWithTeam(t, platform.ID)
	revokedResp, err := client.CreateGrant(t.Context(), userIDGrant(revokedUserID, api.CreateGrantRequestRelationAdmin), api.CreateGrantParams{ProjectID: api.ProjectID(project.ID)})
	require.NoError(t, err)
	revokedGrant, ok := revokedResp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, revokedResp))
	delResp, err := client.DeleteGrant(t.Context(), api.DeleteGrantParams{
		ID:        revokedGrant.ID,
		ProjectID: api.ProjectID(project.ID),
	})
	require.NoError(t, err)
	require.IsType(t, &api.DeleteGrantNoContent{}, delResp, helpers.MustMarshal(t, delResp))

	expiredUserID := harness.CreateUserWithTeam(t, platform.ID)
	expiredAt := time.Now().Add(-time.Hour)
	expiredAsgn := &domain.AuthzAssignment{
		ProjectID:     project.ID,
		CatalogID:     domain.SystemCatalogID,
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   expiredUserID,
		ObjectType:    "project",
		Relation:      "admin",
		ExpiresAt:     &expiredAt,
	}
	expiredAsgn.ApplyScope(domain.NewProjectAssignmentScope())
	require.NoError(t, stmts.CreateAuthzAssignment(t.Context(), expiredAsgn))

	setupAsgns, err := stmts.ListAuthzAssignments(t.Context(), project.ID, domain.AuthzPrincipalTypeSKProj, project.ID, false)
	require.NoError(t, err)
	require.NotEmpty(t, setupAsgns)

	queryGrants := func(t *testing.T, req *api.QueryGrantsRequest) *api.QueryGrantsResponse {
		t.Helper()
		resp, err := client.QueryGrants(t.Context(), req, params)
		require.NoError(t, err)
		require.IsType(t, &api.QueryGrantsResponse{}, resp, helpers.MustMarshal(t, resp))
		return resp.(*api.QueryGrantsResponse)
	}
	byID := func(grants []api.Grant) map[string]api.Grant {
		out := make(map[string]api.Grant, len(grants))
		for _, g := range grants {
			out[g.ID] = g
		}
		return out
	}

	page := queryGrants(t, &api.QueryGrantsRequest{})
	got := byID(page.Grants)
	require.Contains(t, got, userGrant.ID)
	require.Contains(t, got, teamGrant.ID)
	require.Contains(t, got, expiredAsgn.ID)
	assert.NotContains(t, got, revokedGrant.ID)
	assert.NotContains(t, got, setupAsgns[0].ID)
	assert.NotContains(t, got, owning.ID)

	listedUser := got[userGrant.ID]
	require.True(t, listedUser.User.IsSet())
	assert.Equal(t, api.UserID(userID), listedUser.User.Value.UserID)
	assert.True(t, listedUser.User.Value.Identifier.IsSet())
	assert.Equal(t, "email", listedUser.User.Value.IdentifierProperty.Or(""))
	assert.False(t, listedUser.Team.IsSet())
	assert.False(t, listedUser.User.Value.Schema.IsSet())

	listedTeam := got[teamGrant.ID]
	require.True(t, listedTeam.Team.IsSet())
	assert.Equal(t, team.ID, listedTeam.Team.Value.TeamID)
	assert.Equal(t, team.Name, listedTeam.Team.Value.Name.Or(""))
	assert.False(t, listedTeam.User.IsSet())
	assert.False(t, listedTeam.Team.Value.Status.IsSet())

	getUser, err := client.GetGrant(t.Context(), getParams(userGrant.ID))
	require.NoError(t, err)
	gotUser, ok := getUser.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, getUser))
	assert.Equal(t, listedUser.ID, gotUser.ID)
	assert.Equal(t, listedUser.User, gotUser.User)
	assert.Equal(t, listedUser.Team, gotUser.Team)
	assert.False(t, gotUser.User.Value.Schema.IsSet())

	getTeam, err := client.GetGrant(t.Context(), getParams(teamGrant.ID))
	require.NoError(t, err)
	gotTeam, ok := getTeam.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, getTeam))
	assert.Equal(t, listedTeam.ID, gotTeam.ID)
	assert.Equal(t, listedTeam.Team, gotTeam.Team)

	getExpired, err := client.GetGrant(t.Context(), getParams(expiredAsgn.ID))
	require.NoError(t, err)
	gotExpired, ok := getExpired.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, getExpired))
	assert.Equal(t, expiredAsgn.ID, gotExpired.ID)
	assert.True(t, gotExpired.ExpiresAt.IsSet())

	usersOnly := queryGrants(t, &api.QueryGrantsRequest{
		Filter: []api.QueryGrantsRequestFilterItem{{
			Field:     api.GrantFilterFieldUserID,
			Operation: api.FilterOperationEquals,
			Value:     api.NewOptFilterValue(api.NewStringFilterValue(userID)),
		}},
	})
	require.Len(t, usersOnly.Grants, 1)
	require.True(t, usersOnly.Grants[0].User.IsSet())
	assert.Equal(t, api.UserID(userID), usersOnly.Grants[0].User.Value.UserID)

	teamsOnly := queryGrants(t, &api.QueryGrantsRequest{
		Filter: []api.QueryGrantsRequestFilterItem{{
			Field:     api.GrantFilterFieldTeamID,
			Operation: api.FilterOperationEquals,
			Value:     api.NewOptFilterValue(api.NewStringFilterValue(team.ID)),
		}},
	})
	require.Len(t, teamsOnly.Grants, 1)
	require.True(t, teamsOnly.Grants[0].Team.IsSet())
	assert.Equal(t, team.ID, teamsOnly.Grants[0].Team.Value.TeamID)

	t.Run("401 without token", func(t *testing.T) {
		anon, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		resp, err := anon.QueryGrants(t.Context(), &api.QueryGrantsRequest{}, params)
		require.NoError(t, err)
		require.IsType(t, &api.QueryGrantsUnauthorized{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("403 without operator project.write", func(t *testing.T) {
		denied, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetScopedTokenOnApiClient(t, denied, project, "project.read")
		resp, err := denied.QueryGrants(t.Context(), &api.QueryGrantsRequest{}, params)
		require.NoError(t, err)
		require.IsType(t, &api.QueryGrantsForbidden{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("grant.permission_denied"), resp.(*api.QueryGrantsForbidden).Code)
	})
}

func TestGrantQueryExpand(t *testing.T) {
	t.Parallel()

	platform := harness.EnsurePlatformProject(t)
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	claimProject(t, project.ID)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	platformClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, platformClient, platform)

	params := api.QueryGrantsParams{ProjectID: api.ProjectID(project.ID)}
	createParams := api.CreateGrantParams{ProjectID: api.ProjectID(project.ID)}
	expandPrincipal := []api.GrantExpand{api.GrantExpandPrincipal}

	userID := harness.CreateUserWithTeam(t, platform.ID)
	userGrantResp, err := client.CreateGrant(t.Context(), userIDGrant(userID, api.CreateGrantRequestRelationViewer), createParams)
	require.NoError(t, err)
	userGrant, ok := userGrantResp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, userGrantResp))

	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: platform.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)
	teamGrantResp, err := client.CreateGrant(t.Context(), teamIDGrant(team.ID, api.CreateGrantRequestRelationEditor), createParams)
	require.NoError(t, err)
	teamGrant, ok := teamGrantResp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, teamGrantResp))

	deletedUserID := harness.CreateUserWithTeam(t, platform.ID)
	deletedGrantResp, err := client.CreateGrant(t.Context(), userIDGrant(deletedUserID, api.CreateGrantRequestRelationAdmin), createParams)
	require.NoError(t, err)
	deletedGrant, ok := deletedGrantResp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, deletedGrantResp))
	require.NoError(t, harness.EnsureServiceDB(t).Statements().DeleteUserByID(t.Context(), platform.ID, deletedUserID))

	revokedUserID := harness.CreateUserWithTeam(t, platform.ID)
	revokedGrantResp, err := client.CreateGrant(t.Context(), userIDGrant(revokedUserID, api.CreateGrantRequestRelationAdmin), createParams)
	require.NoError(t, err)
	revokedGrant, ok := revokedGrantResp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, revokedGrantResp))
	delUser, err := platformClient.DeleteUserByID(t.Context(), api.DeleteUserByIDParams{UserID: api.UserID(revokedUserID)})
	require.NoError(t, err)
	require.IsType(t, &api.DeleteUserByIDNoContent{}, delUser, helpers.MustMarshal(t, delUser))

	// The project's own secret may not expand (ADR 059 amendment); a platform
	// user with read on both projects may.
	reader := platformReader(t, project.ID)
	queryGrants := func(t *testing.T, req *api.QueryGrantsRequest) *api.QueryGrantsResponse {
		t.Helper()
		resp, err := reader.QueryGrants(t.Context(), req, params)
		require.NoError(t, err)
		require.IsType(t, &api.QueryGrantsResponse{}, resp, helpers.MustMarshal(t, resp))
		return resp.(*api.QueryGrantsResponse)
	}
	byID := func(grants []api.Grant) map[string]api.Grant {
		out := make(map[string]api.Grant, len(grants))
		for _, g := range grants {
			out[g.ID] = g
		}
		return out
	}

	page := queryGrants(t, &api.QueryGrantsRequest{Expand: expandPrincipal})
	got := byID(page.Grants)
	require.Contains(t, got, userGrant.ID)
	require.Contains(t, got, teamGrant.ID)
	require.Contains(t, got, deletedGrant.ID)
	assert.NotContains(t, got, revokedGrant.ID, "deleting the user through the API revokes their grant")

	listedUser := got[userGrant.ID]
	require.True(t, listedUser.User.IsSet())
	require.True(t, listedUser.User.Value.Schema.IsSet())
	require.True(t, listedUser.User.Value.Metadata.IsSet())
	getUser, err := platformClient.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(userID)})
	require.NoError(t, err)
	wantUser, ok := getUser.(*api.User)
	require.True(t, ok, helpers.MustMarshal(t, getUser))
	assert.Equal(t, wantUser.Schema, listedUser.User.Value.Schema.Value)
	assert.Equal(t, wantUser.Attributes, listedUser.User.Value.Attributes.Value)
	assert.Equal(t, wantUser.Metadata.Status, listedUser.User.Value.Metadata.Value.Status)

	listedTeam := got[teamGrant.ID]
	require.True(t, listedTeam.Team.IsSet())
	require.True(t, listedTeam.Team.Value.Status.IsSet())
	getTeam, err := platformClient.GetTeam(t.Context(), api.GetTeamParams{TeamID: api.TeamID(team.ID)})
	require.NoError(t, err)
	wantTeam, ok := getTeam.(*api.TeamResponse)
	require.True(t, ok, helpers.MustMarshal(t, getTeam))
	assert.Equal(t, wantTeam.Status, listedTeam.Team.Value.Status.Value)
	assert.Equal(t, wantTeam.CreatedAt, listedTeam.Team.Value.CreatedAt.Value)
	assert.Equal(t, wantTeam.UpdatedAt, listedTeam.Team.Value.UpdatedAt.Value)

	listedDeleted := got[deletedGrant.ID]
	require.True(t, listedDeleted.User.IsSet())
	assert.Equal(t, api.UserID(deletedUserID), listedDeleted.User.Value.UserID)
	assert.False(t, listedDeleted.User.Value.Schema.IsSet())

	withoutExpand := queryGrants(t, &api.QueryGrantsRequest{Limit: api.NewOptLimit(1)})
	withExpand := queryGrants(t, &api.QueryGrantsRequest{
		Limit:  api.NewOptLimit(1),
		Expand: expandPrincipal,
	})
	assert.Equal(t, withoutExpand.NextPageToken, withExpand.NextPageToken)
	require.True(t, withoutExpand.NextPageToken.IsSet())
	token := withoutExpand.NextPageToken.Value
	followWithout := queryGrants(t, &api.QueryGrantsRequest{
		Limit:     api.NewOptLimit(1),
		PageToken: api.NewOptNilPageToken(token),
	})
	followWith := queryGrants(t, &api.QueryGrantsRequest{
		Limit:     api.NewOptLimit(1),
		PageToken: api.NewOptNilPageToken(token),
		Expand:    expandPrincipal,
	})
	require.Len(t, followWithout.Grants, 1)
	require.Len(t, followWith.Grants, 1)
	assert.Equal(t, followWithout.Grants[0].ID, followWith.Grants[0].ID)
	assert.False(t, followWithout.Grants[0].User.Value.Schema.IsSet() || followWithout.Grants[0].Team.Value.Status.IsSet())
	assert.True(t, followWith.Grants[0].User.Value.Schema.IsSet() || followWith.Grants[0].Team.Value.Status.IsSet())

	t.Run("unknown expand is 400", func(t *testing.T) {
		body := `{"expand":["nope"]}`
		req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
			harness.APIBaseURL(t)+"/grants/query?project_id="+url.QueryEscape(project.ID),
			strings.NewReader(body),
		)
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+client.Token())
		resp, err := harness.EnsureHttpClient(t).Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		raw, err := io.ReadAll(resp.Body)
		require.NoError(t, err)
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode, string(raw))
		details := helpers.MustUnmarshal[api.ErrorDetails](t, raw)
		assert.Equal(t, api.ErrorCode("req.invalid"), details.Code)
	})

	t.Run("403 project.read-only with expand", func(t *testing.T) {
		denied, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetScopedTokenOnApiClient(t, denied, project, "project.read")
		resp, err := denied.QueryGrants(t.Context(), &api.QueryGrantsRequest{Expand: expandPrincipal}, params)
		require.NoError(t, err)
		require.IsType(t, &api.QueryGrantsForbidden{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("grant.permission_denied"), resp.(*api.QueryGrantsForbidden).Code)
	})

	t.Run("project secret expand is 403", func(t *testing.T) {
		resp, err := client.QueryGrants(t.Context(), &api.QueryGrantsRequest{Expand: expandPrincipal}, params)
		require.NoError(t, err)
		require.IsType(t, &api.QueryGrantsForbidden{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("user.permission_denied"), resp.(*api.QueryGrantsForbidden).Code)

		getResp, err := client.GetGrant(t.Context(), api.GetGrantParams{
			ID:        userGrant.ID,
			ProjectID: api.ProjectID(project.ID),
			Expand:    expandPrincipal,
		})
		require.NoError(t, err)
		require.IsType(t, &api.GetGrantForbidden{}, getResp, helpers.MustMarshal(t, getResp))
		assert.Equal(t, api.ErrorCode("user.permission_denied"), getResp.(*api.GetGrantForbidden).Code)
	})

	t.Run("GET expand inlines extras", func(t *testing.T) {
		getResp, err := reader.GetGrant(t.Context(), api.GetGrantParams{
			ID:        userGrant.ID,
			ProjectID: api.ProjectID(project.ID),
			Expand:    expandPrincipal,
		})
		require.NoError(t, err)
		got, ok := getResp.(*api.Grant)
		require.True(t, ok, helpers.MustMarshal(t, getResp))
		require.True(t, got.User.IsSet())
		assert.True(t, got.User.Value.Schema.IsSet())
		assert.True(t, got.User.Value.Metadata.IsSet())
	})
}

func grantByID(t *testing.T, grants []api.Grant, id string) api.Grant {
	t.Helper()
	for _, g := range grants {
		if g.ID == id {
			return g
		}
	}
	t.Fatalf("grant %s not in page %s", id, helpers.MustMarshal(t, grants))
	return api.Grant{}
}

func assertGrantNotFound(t *testing.T, resp any) {
	t.Helper()
	switch v := resp.(type) {
	case *api.CreateGrantNotFound:
		assert.Equal(t, api.ErrorCode("grant.not_found"), v.Code)
	case *api.GetGrantNotFound:
		assert.Equal(t, api.ErrorCode("grant.not_found"), v.Code)
	case *api.DeleteGrantNotFound:
		assert.Equal(t, api.ErrorCode("grant.not_found"), v.Code)
	case *api.QueryGrantsErrorResponseStatusCode:
		assert.Equal(t, http.StatusNotFound, v.StatusCode)
		require.True(t, v.Response.IsGrantNotFound(), helpers.MustMarshal(t, resp))
		assert.Equal(t, "grant.not_found", v.Response.GrantNotFound.Code)
	default:
		t.Fatalf("want grant.not_found, got %T %s", resp, helpers.MustMarshal(t, resp))
	}
}

func assertCreateGrantReqInvalid(t *testing.T, token, projectID, body string) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
		harness.APIBaseURL(t)+"/grants?project_id="+url.QueryEscape(projectID),
		strings.NewReader(body),
	)
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := harness.EnsureHttpClient(t).Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode, string(raw))
	details := helpers.MustUnmarshal[api.ErrorDetails](t, raw)
	assert.Equal(t, api.ErrorCode("req.invalid"), details.Code)
}

func assertGrantPrincipalNotFound(t *testing.T, resp any) {
	t.Helper()
	nf, ok := resp.(*api.CreateGrantNotFound)
	require.True(t, ok, helpers.MustMarshal(t, resp))
	assert.Equal(t, api.ErrorCode("grant.principal_not_found"), nf.Code)
}

func assertGrantAlreadyExists(t *testing.T, resp any) {
	t.Helper()
	conflict, ok := resp.(*api.CreateGrantConflict)
	require.True(t, ok, helpers.MustMarshal(t, resp))
	assert.Equal(t, api.ErrorCode("grant.already_exists"), conflict.Code)
}

func TestGrantSessionCaller(t *testing.T) {
	t.Parallel()

	platform := harness.EnsurePlatformProject(t)
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	claimProject(t, project.ID)

	operatorID := harness.CreateUserWithTeam(t, platform.ID)
	harness.SeedProjectAdmin(t, project.ID, operatorID)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	client.SetSessionToken(platformSessionCookie(t, operatorID).Value)

	subjectID := harness.CreateUserWithTeam(t, platform.ID)
	params := api.CreateGrantParams{ProjectID: api.ProjectID(project.ID)}

	createResp, err := client.CreateGrant(t.Context(), userIDGrant(subjectID, api.CreateGrantRequestRelationViewer), params)
	require.NoError(t, err)
	created, ok := createResp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, createResp))
	assert.Equal(t, project.ID, created.ProjectID)
	require.True(t, created.User.IsSet())
	assert.Equal(t, api.UserID(subjectID), created.User.Value.UserID)

	getResp, err := client.GetGrant(t.Context(), api.GetGrantParams{
		ID:        created.ID,
		ProjectID: api.ProjectID(project.ID),
	})
	require.NoError(t, err)
	got, ok := getResp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, getResp))
	assert.Equal(t, created.ID, got.ID)

	queryParams := api.QueryGrantsParams{ProjectID: api.ProjectID(project.ID)}
	listResp, err := client.QueryGrants(t.Context(), &api.QueryGrantsRequest{}, queryParams)
	require.NoError(t, err)
	listed, ok := listResp.(*api.QueryGrantsResponse)
	require.True(t, ok, helpers.MustMarshal(t, listResp))
	listedGrant := grantByID(t, listed.Grants, created.ID)
	assert.False(t, listedGrant.User.Value.Schema.IsSet())

	// Admin on the project is not read on the platform project, where the
	// subject's profile lives.
	expandResp, err := client.QueryGrants(t.Context(), &api.QueryGrantsRequest{
		Expand: []api.GrantExpand{api.GrantExpandPrincipal},
	}, queryParams)
	require.NoError(t, err)
	require.IsType(t, &api.QueryGrantsForbidden{}, expandResp, helpers.MustMarshal(t, expandResp))
	assert.Equal(t, api.ErrorCode("user.permission_denied"), expandResp.(*api.QueryGrantsForbidden).Code)

	delResp, err := client.DeleteGrant(t.Context(), api.DeleteGrantParams{
		ID:        created.ID,
		ProjectID: api.ProjectID(project.ID),
	})
	require.NoError(t, err)
	require.IsType(t, &api.DeleteGrantNoContent{}, delResp, helpers.MustMarshal(t, delResp))

	t.Run("editor cannot mint grants", func(t *testing.T) {
		t.Parallel()
		// Creating a grant is an admin check: a grant can carry any role up to
		// admin, so an editor minting one could escalate (for instance, admin
		// to a team it belongs to, which the self-grant rule does not cover).
		editorID := harness.CreateUserWithTeam(t, platform.ID)
		harness.SeedProjectEditor(t, project.ID, editorID)
		editor, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		editor.SetSessionToken(platformSessionCookie(t, editorID).Value)

		// The check runs before the body is read, so the requested relation
		// cannot change the answer; one request proves the gate.
		resp, err := editor.CreateGrant(t.Context(), userIDGrant(harness.CreateUserWithTeam(t, platform.ID), api.CreateGrantRequestRelationViewer), params)
		require.NoError(t, err)
		forbidden, ok := resp.(*api.CreateGrantForbidden)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode(domain.ErrGrantPermissionDenied().Code), forbidden.Code)

		// Reading grants stays open to an editor.
		queryResp, err := editor.QueryGrants(t.Context(), &api.QueryGrantsRequest{}, api.QueryGrantsParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.QueryGrantsResponse{}, queryResp, helpers.MustMarshal(t, queryResp))
	})

	t.Run("no foothold is not found", func(t *testing.T) {
		t.Parallel()
		strangerID := harness.CreateUserWithTeam(t, platform.ID)
		stranger, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		stranger.SetSessionToken(platformSessionCookie(t, strangerID).Value)
		resp, err := stranger.CreateGrant(t.Context(), userIDGrant(harness.CreateUserWithTeam(t, platform.ID), api.CreateGrantRequestRelationViewer), params)
		require.NoError(t, err)
		assertGrantNotFound(t, resp)

		queryResp, err := stranger.QueryGrants(t.Context(), &api.QueryGrantsRequest{
			Expand: []api.GrantExpand{api.GrantExpandPrincipal},
		}, api.QueryGrantsParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		assertGrantNotFound(t, queryResp)
	})
}

// TestGrantAnonymousProjectCannotReadPlatformUser follows zitadel/nextgen#2653
// step by step: a project created without a credential grants a platform user
// with the secret the create answered, then reads that user. Granting needs a
// claimed project (ADR 054 §4 amendment), and once claimed the project reads
// the grant's label only: the profile needs read on the platform project
// (ADR 059 amendment).
func TestGrantAnonymousProjectCannotReadPlatformUser(t *testing.T) {
	t.Parallel()

	platform := harness.EnsurePlatformProject(t)
	platformClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, platformClient, platform)

	anonymous, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	created, err := anonymous.CreateProject(t.Context(), &api.CreateProjectRequest{Name: helpers.ProjectName()})
	require.NoError(t, err)
	project, ok := created.(*api.CreateProjectResponse)
	require.True(t, ok, helpers.MustMarshal(t, created))
	harness.CleanupProject(t, project.ID)
	// The secret from the response body: what whoever created the project holds.
	attacker, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	attacker.SetToken(project.ProjectSecret)

	// A schema that designates a display, so the label carries one as well as
	// the identifier; the seeded default designates no display properties.
	// It stays in the shared platform project after the test: a release
	// another test deploys there may pin it.
	suffix := strings.ToLower(helpers.RandString(8))
	displaySchema := harness.CreateUserSchema(t, platform, `{
		"title": "GrantLabelSchema",
		"metaSchema": "https://test.example.schemas.com/schemas/user-schema.json",
		"$id": "https://grant-label-`+suffix+`.example.com/schemas/human-user.json",
		"kind": "user-schema",
		"objectType": "grant-label-`+suffix+`",
		"type": "object",
		"x-identifier": "email",
		"x-display": ["givenName", "familyName"],
		"x-auth-methods": {"password": {"enabled": true}},
		"properties": {
			"email": {"type": "string", "format": "email", "x-unique": "project"},
			"givenName": {"type": "string"},
			"familyName": {"type": "string"}
		}
	}`)
	var createUser api.CreateUserRequest
	require.NoError(t, createUser.UnmarshalJSON([]byte(helpers.MustMarshal(t, map[string]any{
		"schema": displaySchema,
		"attributes": map[string]any{
			"email":      helpers.RandString(8) + "@example.com",
			"givenName":  "Ada",
			"familyName": "Lovelace",
		},
	}))))
	createdUser, err := platformClient.CreateUser(t.Context(), &createUser, api.CreateUserParams{ProjectID: api.ProjectID(platform.ID)})
	require.NoError(t, err)
	createdTarget, ok := createdUser.(*api.User)
	require.True(t, ok, helpers.MustMarshal(t, createdUser))
	targetID := string(createdTarget.ID)
	t.Cleanup(func() {
		stmts := harness.EnsureServiceDB(t).Statements()
		_ = stmts.DeleteUserByID(context.Background(), platform.ID, targetID)
	})
	targetResp, err := platformClient.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(targetID)})
	require.NoError(t, err)
	target, ok := targetResp.(*api.User)
	require.True(t, ok, helpers.MustMarshal(t, targetResp))
	require.True(t, target.Identifier.IsSet())
	require.True(t, target.Display.IsSet())
	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: platform.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := harness.EnsureServiceDB(t).Statements().DeactivateTeam(context.Background(), platform.ID, team.ID)
		assert.NoError(t, err)
	})

	createParams := api.CreateGrantParams{ProjectID: api.ProjectID(project.ID)}
	getParams := func(id string, expand ...api.GrantExpand) api.GetGrantParams {
		return api.GetGrantParams{ID: id, ProjectID: api.ProjectID(project.ID), Expand: expand}
	}
	queryParams := api.QueryGrantsParams{ProjectID: api.ProjectID(project.ID)}
	expandPrincipal := []api.GrantExpand{api.GrantExpandPrincipal}

	t.Run("an unclaimed project cannot grant a platform principal", func(t *testing.T) {
		for name, req := range map[string]*api.CreateGrantRequest{
			"user_id":    userIDGrant(targetID, api.CreateGrantRequestRelationViewer),
			"identifier": userIdentifierGrant(target.Identifier.Value, api.CreateGrantRequestRelationViewer),
			"team_id":    teamIDGrant(team.ID, api.CreateGrantRequestRelationViewer),
			"team name":  teamNameGrant(team.Name, api.CreateGrantRequestRelationViewer),
		} {
			resp, err := attacker.CreateGrant(t.Context(), req, createParams)
			require.NoError(t, err)
			forbidden, ok := resp.(*api.CreateGrantForbidden)
			if assert.True(t, ok, "%s: %s", name, helpers.MustMarshal(t, resp)) {
				assert.Equal(t, api.ErrorCode("grant.project_unclaimed"), forbidden.Code, name)
			}
		}
	})

	// Claimed the way claim/complete leaves it: an owning team from the
	// platform project.
	claimProject(t, project.ID)

	createResp, err := attacker.CreateGrant(t.Context(), userIDGrant(targetID, api.CreateGrantRequestRelationEditor), createParams)
	require.NoError(t, err)
	grant, ok := createResp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, createResp))

	assertLabelOnly := func(t *testing.T, got api.Grant) {
		t.Helper()
		require.True(t, got.User.IsSet(), helpers.MustMarshal(t, got))
		user := got.User.Value
		assert.Equal(t, api.UserID(targetID), user.UserID)
		assert.Equal(t, target.Identifier, user.Identifier)
		assert.Equal(t, target.Display, user.Display)
		assert.False(t, user.Schema.IsSet())
		assert.False(t, user.Attributes.IsSet())
		assert.False(t, user.Metadata.IsSet())
	}

	t.Run("the project secret reads the label only", func(t *testing.T) {
		getResp, err := attacker.GetGrant(t.Context(), getParams(grant.ID))
		require.NoError(t, err)
		got, ok := getResp.(*api.Grant)
		require.True(t, ok, helpers.MustMarshal(t, getResp))
		assertLabelOnly(t, *got)

		listed := grantsForUser(t, attacker, project.ID, targetID)
		require.Len(t, listed, 1)
		assertLabelOnly(t, listed[0])
	})

	t.Run("the project secret cannot expand the principal", func(t *testing.T) {
		getResp, err := attacker.GetGrant(t.Context(), getParams(grant.ID, expandPrincipal...))
		require.NoError(t, err)
		forbidden, ok := getResp.(*api.GetGrantForbidden)
		if assert.True(t, ok, helpers.MustMarshal(t, getResp)) {
			assert.Equal(t, api.ErrorCode("user.permission_denied"), forbidden.Code)
		}

		queryResp, err := attacker.QueryGrants(t.Context(), &api.QueryGrantsRequest{Expand: expandPrincipal}, queryParams)
		require.NoError(t, err)
		queryForbidden, ok := queryResp.(*api.QueryGrantsForbidden)
		if assert.True(t, ok, helpers.MustMarshal(t, queryResp)) {
			assert.Equal(t, api.ErrorCode("user.permission_denied"), queryForbidden.Code)
		}
	})

	t.Run("the project secret cannot read the user", func(t *testing.T) {
		userResp, err := attacker.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(targetID)})
		require.NoError(t, err)
		notFound, ok := userResp.(*api.GetUserByIDNotFound)
		require.True(t, ok, helpers.MustMarshal(t, userResp))
		assert.Equal(t, api.ErrorCode("user.not_found"), notFound.Code)

		queryResp, err := attacker.QueryUsers(t.Context(), &api.QueryUsersRequest{}, api.QueryUsersParams{})
		require.NoError(t, err)
		listed, ok := queryResp.(*api.QueryUsersResponse)
		require.True(t, ok, helpers.MustMarshal(t, queryResp))
		for _, u := range listed.Users {
			assert.NotEqual(t, targetID, userID(t, u))
		}
	})

	t.Run("a session with read on the platform project expands", func(t *testing.T) {
		reader := platformReader(t, project.ID)
		getResp, err := reader.GetGrant(t.Context(), getParams(grant.ID, expandPrincipal...))
		require.NoError(t, err)
		got, ok := getResp.(*api.Grant)
		require.True(t, ok, helpers.MustMarshal(t, getResp))
		require.True(t, got.User.IsSet())
		assert.Equal(t, target.Schema, got.User.Value.Schema.Value)
		assert.Equal(t, target.Attributes, got.User.Value.Attributes.Value)
	})

	t.Run("a session without read on the platform project gets the label only", func(t *testing.T) {
		operatorID := harness.CreateUserWithTeam(t, platform.ID)
		cleanupPlatformUserAndTeam(t, operatorID)
		harness.SeedProjectAdmin(t, project.ID, operatorID)
		operator := sessionClientForUser(t, operatorID)

		getResp, err := operator.GetGrant(t.Context(), getParams(grant.ID, expandPrincipal...))
		require.NoError(t, err)
		forbidden, ok := getResp.(*api.GetGrantForbidden)
		if assert.True(t, ok, helpers.MustMarshal(t, getResp)) {
			assert.Equal(t, api.ErrorCode("user.permission_denied"), forbidden.Code)
		}

		listed := grantsForUser(t, operator, project.ID, targetID)
		require.Len(t, listed, 1)
		assertLabelOnly(t, listed[0])
	})
}
