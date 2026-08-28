//go:build postgres_integration || spanner_integration

package integration_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
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
