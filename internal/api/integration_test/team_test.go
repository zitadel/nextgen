//go:build postgres_integration || spanner_integration

package integration_test

import (
	"io"
	"net/http"
	"net/url"
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

		require.IsType(t, &api.CreateTeamResponse{}, resp, helpers.MustMarshal(t, resp))
		created := resp.(*api.CreateTeamResponse)
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

				require.IsType(t, &api.CreateTeamConflict{}, resp, helpers.MustMarshal(t, resp))
				conflict := resp.(*api.CreateTeamConflict)
				assert.Equal(t, api.ErrorCode("team.already_exists"), conflict.Code)
			})
		}

		t.Run("no project", func(t *testing.T) {
			t.Parallel()

			req := &api.CreateTeamRequest{Name: helpers.TeamName()}
			params := api.CreateTeamParams{}

			resp, err := client.CreateTeam(t.Context(), req, params)
			require.NoError(t, err)

			require.IsType(t, &api.CreateTeamBadRequest{}, resp, helpers.MustMarshal(t, resp))
			badRequest := resp.(*api.CreateTeamBadRequest)
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

			require.IsType(t, &api.CreateTeamBadRequest{}, resp, helpers.MustMarshal(t, resp))
			badRequest := resp.(*api.CreateTeamBadRequest)
			assert.Equal(t, api.ErrorCode("team.name_invalid"), badRequest.Code)
		})
	})
}

// TestCreateTeamRawRequest sends raw bodies (e.g., from a curl request or from a non-generated SDK).
func TestCreateTeamRawRequest(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	for _, tc := range []struct {
		name     string
		teamName string
	}{
		{"empty name", ""},
		{"name over the length limit", strings.Repeat("a", domain.TeamNameMaxLength+1)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			body := helpers.MustMarshal(t, api.CreateTeamRequest{Name: tc.teamName})
			req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
				harness.EnsureTestServer(t).URL+"/teams?project_id="+url.QueryEscape(project.ID),
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
	}
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

		require.IsType(t, &api.GetTeamResponse{}, resp, helpers.MustMarshal(t, resp))
		got := resp.(*api.GetTeamResponse)
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

			require.IsType(t, &api.GetTeamNotFound{}, resp, helpers.MustMarshal(t, resp))
			notFound := resp.(*api.GetTeamNotFound)
			assert.Equal(t, api.ErrorCode("team.team_not_found"), notFound.Code)
		})
	})
}
