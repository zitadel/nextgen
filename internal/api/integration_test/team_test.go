//go:build postgres_integration || spanner_integration

package integration_test

import (
	"context"
	"strings"
	"testing"

	"github.com/ogen-go/ogen/validate"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
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

				conflict, ok := resp.(*api.CreateTeamConflict)
				require.True(t, ok, helpers.MustMarshal(t, resp))
				assert.Equal(t, api.ErrorCode("team.already_exists"), conflict.Code)
			})
		}

		t.Run("no project", func(t *testing.T) {
			t.Parallel()

			req := &api.CreateTeamRequest{Name: helpers.TeamName()}
			params := api.CreateTeamParams{}

			resp, err := client.CreateTeam(t.Context(), req, params)
			require.NoError(t, err)

			badRequest, ok := resp.(*api.CreateTeamBadRequest)
			require.True(t, ok, helpers.MustMarshal(t, resp))
			assert.Equal(t, api.ErrorCode("req.invalid"), badRequest.Code)
		})

		// The contract carries minLength/maxLength, so the generated client
		// rejects these before a request is sent.
		for _, tc := range []struct {
			name     string
			teamName string
		}{
			{"empty name", ""},
			{"name over the length limit", strings.Repeat("a", domain.TeamNameMaxLength+1)},
		} {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()

				_, err := client.CreateTeam(t.Context(),
					&api.CreateTeamRequest{Name: tc.teamName},
					api.CreateTeamParams{ProjectID: api.ProjectID(project.ID)},
				)
				require.ErrorAs(t, err, new(*validate.Error))
			})
		}

		t.Run("whitespace-only name", func(t *testing.T) {
			t.Parallel()

			resp, err := client.CreateTeam(t.Context(),
				&api.CreateTeamRequest{Name: "   "},
				api.CreateTeamParams{ProjectID: api.ProjectID(project.ID)},
			)
			require.NoError(t, err)

			badRequest, ok := resp.(*api.CreateTeamBadRequest)
			require.True(t, ok, helpers.MustMarshal(t, resp))
			assert.Equal(t, api.ErrorCode("team.name_invalid"), badRequest.Code)
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

		team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
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

		got, ok := resp.(*api.TeamResponse)
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

			notFound, ok := resp.(*api.GetTeamNotFound)
			require.True(t, ok, helpers.MustMarshal(t, resp))
			assert.Equal(t, api.ErrorCode("team.team_not_found"), notFound.Code)
		})
	})
}

func TestUpdateTeam(t *testing.T) {
	t.Parallel()

	// Teams have no delete statement; they cascade with their project.
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = harness.EnsureServiceDB(t).Statements().DeleteProjectByID(context.Background(), project.ID)
	})

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
			ProjectID: project.ID,
			Name:      helpers.TeamName(),
		})
		require.NoError(t, err)

		name := helpers.TeamName()
		params := api.UpdateTeamParams{
			ProjectID: api.ProjectID(project.ID),
			TeamID:    api.TeamID(team.ID),
		}

		resp, err := client.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: name}, params)
		require.NoError(t, err)

		updated, ok := resp.(*api.TeamResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, name, updated.Name)
		assert.False(t, updated.UpdatedAt.Before(updated.CreatedAt))
	})

	t.Run("name is trimmed", func(t *testing.T) {
		t.Parallel()

		team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
			ProjectID: project.ID,
			Name:      helpers.TeamName(),
		})
		require.NoError(t, err)

		name := helpers.TeamName()
		params := api.UpdateTeamParams{
			ProjectID: api.ProjectID(project.ID),
			TeamID:    api.TeamID(team.ID),
		}

		resp, err := client.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: "  " + name + "  "}, params)
		require.NoError(t, err)

		updated, ok := resp.(*api.TeamResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, name, updated.Name)
	})

	t.Run("same name in another project", func(t *testing.T) {
		t.Parallel()

		otherProject, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		t.Cleanup(func() {
			_ = harness.EnsureServiceDB(t).Statements().DeleteProjectByID(context.Background(), otherProject.ID)
		})

		name := helpers.TeamName()
		_, err = harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
			ProjectID: otherProject.ID,
			Name:      name,
		})
		require.NoError(t, err)

		team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
			ProjectID: project.ID,
			Name:      helpers.TeamName(),
		})
		require.NoError(t, err)

		params := api.UpdateTeamParams{
			ProjectID: api.ProjectID(project.ID),
			TeamID:    api.TeamID(team.ID),
		}

		resp, err := client.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: name}, params)
		require.NoError(t, err)
		assert.IsType(t, &api.TeamResponse{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("error", func(t *testing.T) {
		t.Parallel()

		t.Run("whitespace-only name", func(t *testing.T) {
			t.Parallel()

			team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
				ProjectID: project.ID,
				Name:      helpers.TeamName(),
			})
			require.NoError(t, err)

			params := api.UpdateTeamParams{
				ProjectID: api.ProjectID(project.ID),
				TeamID:    api.TeamID(team.ID),
			}

			resp, err := client.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: "   "}, params)
			require.NoError(t, err)

			badRequest, ok := resp.(*api.UpdateTeamBadRequest)
			require.True(t, ok, helpers.MustMarshal(t, resp))
			assert.Equal(t, api.ErrorCode("team.name_invalid"), badRequest.Code)
		})

		t.Run("non existing team", func(t *testing.T) {
			t.Parallel()

			params := api.UpdateTeamParams{
				ProjectID: api.ProjectID(project.ID),
				TeamID:    api.TeamID("does-not-exist"),
			}

			resp, err := client.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: helpers.TeamName()}, params)
			require.NoError(t, err)

			notFound, ok := resp.(*api.UpdateTeamNotFound)
			require.True(t, ok, helpers.MustMarshal(t, resp))
			assert.Equal(t, api.ErrorCode("team.team_not_found"), notFound.Code)
		})

		// A deactivated team is indistinguishable from a missing one.
		t.Run("deactivated team", func(t *testing.T) {
			t.Parallel()

			team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
				ProjectID: project.ID,
				Name:      helpers.TeamName(),
			})
			require.NoError(t, err)
			require.NoError(t, harness.EnsureServiceDB(t).Statements().DeactivateTeam(t.Context(), project.ID, team.ID))

			params := api.UpdateTeamParams{
				ProjectID: api.ProjectID(project.ID),
				TeamID:    api.TeamID(team.ID),
			}

			resp, err := client.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: helpers.TeamName()}, params)
			require.NoError(t, err)

			notFound, ok := resp.(*api.UpdateTeamNotFound)
			require.True(t, ok, helpers.MustMarshal(t, resp))
			assert.Equal(t, api.ErrorCode("team.team_not_found"), notFound.Code)
		})

		for _, tc := range []struct {
			name    string
			nameFor func(string) string
		}{
			{"duplicate name", func(name string) string { return name }},
			{"duplicate name differing only in case", strings.ToUpper},
		} {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()

				taken := helpers.TeamName()
				_, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
					ProjectID: project.ID,
					Name:      taken,
				})
				require.NoError(t, err)

				team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
					ProjectID: project.ID,
					Name:      helpers.TeamName(),
				})
				require.NoError(t, err)

				params := api.UpdateTeamParams{
					ProjectID: api.ProjectID(project.ID),
					TeamID:    api.TeamID(team.ID),
				}

				resp, err := client.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: tc.nameFor(taken)}, params)
				require.NoError(t, err)

				conflict, ok := resp.(*api.UpdateTeamConflict)
				require.True(t, ok, helpers.MustMarshal(t, resp))
				assert.Equal(t, api.ErrorCode("team.already_exists"), conflict.Code)
			})
		}

		// The contract carries minLength/maxLength, so the generated client
		// rejects these before a request is sent.
		for _, tc := range []struct {
			name     string
			teamName string
		}{
			{"empty name", ""},
			{"name over the length limit", strings.Repeat("a", domain.TeamNameMaxLength+1)},
		} {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()

				params := api.UpdateTeamParams{
					ProjectID: api.ProjectID(project.ID),
					TeamID:    api.TeamID("does-not-exist"),
				}

				_, err := client.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: tc.teamName}, params)
				require.ErrorAs(t, err, new(*validate.Error))
			})
		}
	})
}
