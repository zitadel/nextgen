//go:build postgres_integration || spanner_integration

package integration_test

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func TestGrantCreateGetRevoke(t *testing.T) {
	t.Parallel()

	platform := harness.EnsurePlatformProject(t)
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	params := func() api.CreateGrantParams {
		return api.CreateGrantParams{ProjectID: api.ProjectID(project.ID)}
	}

	t.Run("user grant happy path", func(t *testing.T) {
		t.Parallel()

		userID := harness.CreateUserWithTeam(t, platform.ID)
		createResp, err := client.CreateGrant(t.Context(), &api.CreateGrantRequest{
			PrincipalType: api.CreateGrantRequestPrincipalTypeUser,
			PrincipalID:   userID,
			Relation:      api.CreateGrantRequestRelationViewer,
		}, params())
		require.NoError(t, err)
		created, ok := createResp.(*api.Grant)
		require.True(t, ok, helpers.MustMarshal(t, createResp))
		assert.True(t, strings.HasPrefix(created.ID, "asgn_"), created.ID)
		assert.Equal(t, project.ID, created.ProjectID)
		assert.Equal(t, userID, created.PrincipalID)
		assert.Equal(t, api.GrantPrincipalTypeUser, created.PrincipalType)
		assert.Equal(t, api.GrantRelationViewer, created.Relation)
		assert.Equal(t, api.GrantObjectTypeProject, created.ObjectType)
		require.True(t, created.User.IsSet())
		assert.Equal(t, api.UserID(userID), created.User.Value.UserID)
		assert.True(t, created.User.Value.Identifier.IsSet())
		assert.False(t, created.Team.IsSet())
		assert.False(t, created.Principal.IsSet())

		getResp, err := client.GetGrant(t.Context(), api.GetGrantParams{
			ID:        created.ID,
			ProjectID: api.ProjectID(project.ID),
		})
		require.NoError(t, err)
		got, ok := getResp.(*api.Grant)
		require.True(t, ok, helpers.MustMarshal(t, getResp))
		assert.Equal(t, created.ID, got.ID)

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

		createResp, err := client.CreateGrant(t.Context(), &api.CreateGrantRequest{
			PrincipalType: api.CreateGrantRequestPrincipalTypeTeam,
			PrincipalID:   team.ID,
			Relation:      api.CreateGrantRequestRelationEditor,
		}, params())
		require.NoError(t, err)
		created, ok := createResp.(*api.Grant)
		require.True(t, ok, helpers.MustMarshal(t, createResp))
		assert.Equal(t, api.GrantPrincipalTypeTeam, created.PrincipalType)
		assert.Equal(t, api.GrantRelationEditor, created.Relation)
		require.True(t, created.Team.IsSet())
		assert.Equal(t, team.ID, created.Team.Value.TeamID)
		assert.Equal(t, team.Name, created.Team.Value.Name.Or(""))
		assert.False(t, created.User.IsSet())
		assert.False(t, created.Principal.IsSet())

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
		req := &api.CreateGrantRequest{
			PrincipalType: api.CreateGrantRequestPrincipalTypeUser,
			PrincipalID:   userID,
			Relation:      api.CreateGrantRequestRelationAdmin,
		}
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
		resp, err := foreign.CreateGrant(t.Context(), &api.CreateGrantRequest{
			PrincipalType: api.CreateGrantRequestPrincipalTypeUser,
			PrincipalID:   userID,
			Relation:      api.CreateGrantRequestRelationViewer,
		}, params())
		require.NoError(t, err)
		assertGrantNotFound(t, resp)
	})

	t.Run("revoke then re-create same binding", func(t *testing.T) {
		t.Parallel()

		userID := harness.CreateUserWithTeam(t, platform.ID)
		req := &api.CreateGrantRequest{
			PrincipalType: api.CreateGrantRequestPrincipalTypeUser,
			PrincipalID:   userID,
			Relation:      api.CreateGrantRequestRelationViewer,
		}
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

		team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
			ProjectID: platform.ID,
			Name:      helpers.TeamName(),
		})
		require.NoError(t, err)

		stmts := harness.EnsureServiceDB(t).Statements()
		asgn := domain.NewClaimTeamAssignment(project.ID, team.ID)
		require.NoError(t, stmts.CreateAuthzAssignment(t.Context(), asgn))
		require.NotEmpty(t, asgn.ID)

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

func TestGrantQuery(t *testing.T) {
	t.Parallel()

	platform := harness.EnsurePlatformProject(t)
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	params := api.QueryGrantsParams{ProjectID: api.ProjectID(project.ID)}
	getParams := func(id string) api.GetGrantParams {
		return api.GetGrantParams{ID: id, ProjectID: api.ProjectID(project.ID)}
	}

	userID := harness.CreateUserWithTeam(t, platform.ID)
	userGrantResp, err := client.CreateGrant(t.Context(), &api.CreateGrantRequest{
		PrincipalType: api.CreateGrantRequestPrincipalTypeUser,
		PrincipalID:   userID,
		Relation:      api.CreateGrantRequestRelationViewer,
	}, api.CreateGrantParams{ProjectID: api.ProjectID(project.ID)})
	require.NoError(t, err)
	userGrant, ok := userGrantResp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, userGrantResp))

	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: platform.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)
	teamGrantResp, err := client.CreateGrant(t.Context(), &api.CreateGrantRequest{
		PrincipalType: api.CreateGrantRequestPrincipalTypeTeam,
		PrincipalID:   team.ID,
		Relation:      api.CreateGrantRequestRelationEditor,
	}, api.CreateGrantParams{ProjectID: api.ProjectID(project.ID)})
	require.NoError(t, err)
	teamGrant, ok := teamGrantResp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, teamGrantResp))

	revokedUserID := harness.CreateUserWithTeam(t, platform.ID)
	revokedResp, err := client.CreateGrant(t.Context(), &api.CreateGrantRequest{
		PrincipalType: api.CreateGrantRequestPrincipalTypeUser,
		PrincipalID:   revokedUserID,
		Relation:      api.CreateGrantRequestRelationAdmin,
	}, api.CreateGrantParams{ProjectID: api.ProjectID(project.ID)})
	require.NoError(t, err)
	revokedGrant, ok := revokedResp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, revokedResp))
	delResp, err := client.DeleteGrant(t.Context(), api.DeleteGrantParams{
		ID:        revokedGrant.ID,
		ProjectID: api.ProjectID(project.ID),
	})
	require.NoError(t, err)
	require.IsType(t, &api.DeleteGrantNoContent{}, delResp, helpers.MustMarshal(t, delResp))

	stmts := harness.EnsureServiceDB(t).Statements()
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

	owningTeam, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: platform.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)
	owning := domain.NewClaimTeamAssignment(project.ID, owningTeam.ID)
	require.NoError(t, stmts.CreateAuthzAssignment(t.Context(), owning))

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
	assert.False(t, listedUser.Principal.IsSet())

	listedTeam := got[teamGrant.ID]
	require.True(t, listedTeam.Team.IsSet())
	assert.Equal(t, team.ID, listedTeam.Team.Value.TeamID)
	assert.Equal(t, team.Name, listedTeam.Team.Value.Name.Or(""))
	assert.False(t, listedTeam.User.IsSet())
	assert.False(t, listedTeam.Principal.IsSet())

	getUser, err := client.GetGrant(t.Context(), getParams(userGrant.ID))
	require.NoError(t, err)
	gotUser, ok := getUser.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, getUser))
	assert.Equal(t, listedUser.ID, gotUser.ID)
	assert.Equal(t, listedUser.PrincipalID, gotUser.PrincipalID)
	assert.Equal(t, listedUser.User, gotUser.User)
	assert.Equal(t, listedUser.Team, gotUser.Team)
	assert.False(t, gotUser.Principal.IsSet())

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
			Field:     api.GrantFilterFieldPrincipalType,
			Operation: api.FilterOperationEquals,
			Value:     api.NewOptFilterValue(api.NewStringFilterValue("user")),
		}},
	})
	for _, g := range usersOnly.Grants {
		assert.Equal(t, api.GrantPrincipalTypeUser, g.PrincipalType)
	}

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
	userGrantResp, err := client.CreateGrant(t.Context(), &api.CreateGrantRequest{
		PrincipalType: api.CreateGrantRequestPrincipalTypeUser,
		PrincipalID:   userID,
		Relation:      api.CreateGrantRequestRelationViewer,
	}, createParams)
	require.NoError(t, err)
	userGrant, ok := userGrantResp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, userGrantResp))

	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: platform.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)
	teamGrantResp, err := client.CreateGrant(t.Context(), &api.CreateGrantRequest{
		PrincipalType: api.CreateGrantRequestPrincipalTypeTeam,
		PrincipalID:   team.ID,
		Relation:      api.CreateGrantRequestRelationEditor,
	}, createParams)
	require.NoError(t, err)
	teamGrant, ok := teamGrantResp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, teamGrantResp))

	deletedUserID := harness.CreateUserWithTeam(t, platform.ID)
	deletedGrantResp, err := client.CreateGrant(t.Context(), &api.CreateGrantRequest{
		PrincipalType: api.CreateGrantRequestPrincipalTypeUser,
		PrincipalID:   deletedUserID,
		Relation:      api.CreateGrantRequestRelationAdmin,
	}, createParams)
	require.NoError(t, err)
	deletedGrant, ok := deletedGrantResp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, deletedGrantResp))
	delUser, err := platformClient.DeleteUserByID(t.Context(), api.DeleteUserByIDParams{UserID: api.UserID(deletedUserID)})
	require.NoError(t, err)
	require.IsType(t, &api.DeleteUserByIDNoContent{}, delUser, helpers.MustMarshal(t, delUser))

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

	page := queryGrants(t, &api.QueryGrantsRequest{Expand: expandPrincipal})
	got := byID(page.Grants)
	require.Contains(t, got, userGrant.ID)
	require.Contains(t, got, teamGrant.ID)
	require.Contains(t, got, deletedGrant.ID)

	listedUser := got[userGrant.ID]
	require.True(t, listedUser.User.IsSet())
	require.True(t, listedUser.Principal.IsSet())
	require.False(t, listedUser.Principal.IsNull())
	expandedUser, ok := listedUser.Principal.Value.GetUser()
	require.True(t, ok, "user grant principal must be the User body")
	getUser, err := platformClient.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(userID)})
	require.NoError(t, err)
	wantUser, ok := getUser.(*api.User)
	require.True(t, ok, helpers.MustMarshal(t, getUser))
	assert.Equal(t, *wantUser, expandedUser)

	listedTeam := got[teamGrant.ID]
	require.True(t, listedTeam.Team.IsSet())
	require.True(t, listedTeam.Principal.IsSet())
	require.False(t, listedTeam.Principal.IsNull())
	expandedTeam, ok := listedTeam.Principal.Value.GetTeamResponse()
	require.True(t, ok, "team grant principal must be the Team body")
	getTeam, err := platformClient.GetTeam(t.Context(), api.GetTeamParams{TeamID: api.TeamID(team.ID)})
	require.NoError(t, err)
	wantTeam, ok := getTeam.(*api.TeamResponse)
	require.True(t, ok, helpers.MustMarshal(t, getTeam))
	assert.Equal(t, *wantTeam, expandedTeam)

	listedDeleted := got[deletedGrant.ID]
	require.True(t, listedDeleted.User.IsSet())
	assert.Equal(t, api.UserID(deletedUserID), listedDeleted.User.Value.UserID)
	require.True(t, listedDeleted.Principal.IsSet())
	assert.True(t, listedDeleted.Principal.IsNull())

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
	assert.False(t, followWithout.Grants[0].Principal.IsSet())
	assert.True(t, followWith.Grants[0].Principal.IsSet())

	t.Run("unknown expand is 400", func(t *testing.T) {
		body := `{"expand":["nope"]}`
		req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
			harness.EnsureTestServer(t).URL+"/grants/query?project_id="+url.QueryEscape(project.ID),
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
	default:
		t.Fatalf("want grant.not_found, got %T %s", resp, helpers.MustMarshal(t, resp))
	}
}

func assertGrantAlreadyExists(t *testing.T, resp any) {
	t.Helper()
	conflict, ok := resp.(*api.CreateGrantConflict)
	require.True(t, ok, helpers.MustMarshal(t, resp))
	assert.Equal(t, api.ErrorCode("grant.already_exists"), conflict.Code)
}
