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

func TestCreateTeam(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		name := helpers.TeamName()
		req := &api.CreateTeamRequest{Name: name}
		params := api.CreateTeamParams{
			ProjectID: api.ProjectID(project.ID),
		}

		resp, err := client.CreateTeam(t.Context(), req, params)
		require.NoError(t, err)

		created, ok := resp.(*api.CreateTeamResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, name, created.Name)
	})

	t.Run("same name in another project", func(t *testing.T) {
		t.Parallel()

		otherProject, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		otherClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, otherClient, otherProject)

		name := helpers.TeamName()
		for _, tc := range []struct {
			client    *helpers.ApiClient
			projectID string
		}{
			{client, project.ID},
			{otherClient, otherProject.ID},
		} {
			resp, err := tc.client.CreateTeam(t.Context(),
				&api.CreateTeamRequest{Name: name},
				api.CreateTeamParams{ProjectID: api.ProjectID(tc.projectID)},
			)
			require.NoError(t, err)
			assert.IsType(t, &api.CreateTeamResponse{}, resp, helpers.MustMarshal(t, resp))
		}
	})

	t.Run("error", func(t *testing.T) {
		t.Parallel()

		for _, tc := range []struct {
			name    string
			nameFor func(string) string
		}{
			{"duplicate name", func(name string) string { return name }},
			{"duplicate name differing only in case", strings.ToUpper},
		} {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()

				name := helpers.TeamName()
				params := api.CreateTeamParams{
					ProjectID: api.ProjectID(project.ID),
				}

				resp, err := client.CreateTeam(t.Context(), &api.CreateTeamRequest{Name: name}, params)
				require.NoError(t, err)
				require.IsType(t, &api.CreateTeamResponse{}, resp, helpers.MustMarshal(t, resp))

				resp, err = client.CreateTeam(t.Context(), &api.CreateTeamRequest{Name: tc.nameFor(name)}, params)
				require.NoError(t, err)
				assert.IsType(t, &api.CreateTeamConflict{}, resp, helpers.MustMarshal(t, resp))
			})
		}

		t.Run("no project", func(t *testing.T) {
			t.Parallel()

			req := &api.CreateTeamRequest{Name: helpers.TeamName()}
			params := api.CreateTeamParams{}

			resp, err := client.CreateTeam(t.Context(), req, params)
			require.NoError(t, err)

			assert.IsType(t, &api.CreateTeamBadRequest{}, resp, helpers.MustMarshal(t, resp))
		})

		t.Run("empty name", func(t *testing.T) {
			t.Parallel()

			req := &api.CreateTeamRequest{Name: ""}
			params := api.CreateTeamParams{
				ProjectID: api.ProjectID(project.ID),
			}

			resp, err := client.CreateTeam(t.Context(), req, params)
			require.NoError(t, err)

			assert.IsType(t, &api.CreateTeamBadRequest{}, resp, helpers.MustMarshal(t, resp))
		})
	})
}

func TestGetTeam(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		team, err := harness.EnsureTeamService(t).CreateTeam(t.Context(), service.CreateTeamInput{
			ProjectID: project.ID,
			Name:      helpers.TeamName(),
		})
		require.NoError(t, err)

		params := api.GetTeamParams{
			ProjectID: api.ProjectID(project.ID),
			TeamID:    api.TeamID(team.ID),
		}

		resp, err := client.GetTeam(t.Context(), params)
		require.NoError(t, err)

		got, ok := resp.(*api.GetTeamResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, team.Name, got.Name)
	})

	t.Run("error", func(t *testing.T) {
		t.Parallel()

		t.Run("non existing team", func(t *testing.T) {
			t.Parallel()

			params := api.GetTeamParams{
				ProjectID: api.ProjectID(project.ID),
				TeamID:    api.TeamID("does-not-exist"),
			}

			resp, err := client.GetTeam(t.Context(), params)
			require.NoError(t, err)

			assert.IsType(t, &api.GetTeamNotFound{}, resp, helpers.MustMarshal(t, resp))
		})
	})
}
