//go:build postgres_integration || spanner_integration

package integration_test

import (
	"strings"
	"testing"

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

// TestGrantSessionCaller exercises ADR 053 §5 for grant ops: a platform-homed
// Console session may create/get/revoke grants on a customer project when it
// holds a foothold there. CSRF/Origin are out of scope (#1140).
func TestGrantSessionCaller(t *testing.T) {
	t.Parallel()

	platform := harness.EnsurePlatformProject(t)
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	operatorID := harness.CreateUserWithTeam(t, platform.ID)
	// MVP catalog: assigned viewer closes to editor/admin Checks (seed until #420).
	operatorAsgn := &domain.AuthzAssignment{
		ProjectID:     project.ID,
		CatalogID:     domain.SystemCatalogID,
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   operatorID,
		ObjectType:    "project",
		Relation:      "viewer",
	}
	operatorAsgn.ApplyScope(domain.NewProjectAssignmentScope())
	require.NoError(t, harness.EnsureServiceDB(t).Statements().CreateAuthzAssignment(t.Context(), operatorAsgn))

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	client.SetSessionToken(platformSessionCookie(t, operatorID).Value)

	subjectID := harness.CreateUserWithTeam(t, platform.ID)
	params := api.CreateGrantParams{ProjectID: api.ProjectID(project.ID)}

	createResp, err := client.CreateGrant(t.Context(), &api.CreateGrantRequest{
		PrincipalType: api.CreateGrantRequestPrincipalTypeUser,
		PrincipalID:   subjectID,
		Relation:      api.CreateGrantRequestRelationViewer,
	}, params)
	require.NoError(t, err)
	created, ok := createResp.(*api.Grant)
	require.True(t, ok, helpers.MustMarshal(t, createResp))
	assert.Equal(t, project.ID, created.ProjectID)
	assert.Equal(t, subjectID, created.PrincipalID)

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

	t.Run("no foothold is not found", func(t *testing.T) {
		t.Parallel()
		strangerID := harness.CreateUserWithTeam(t, platform.ID)
		stranger, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		stranger.SetSessionToken(platformSessionCookie(t, strangerID).Value)
		resp, err := stranger.CreateGrant(t.Context(), &api.CreateGrantRequest{
			PrincipalType: api.CreateGrantRequestPrincipalTypeUser,
			PrincipalID:   harness.CreateUserWithTeam(t, platform.ID),
			Relation:      api.CreateGrantRequestRelationViewer,
		}, params)
		require.NoError(t, err)
		assertGrantNotFound(t, resp)
	})
}
