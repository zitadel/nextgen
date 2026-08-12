//go:build postgres_integration || spanner_integration

package integration_test

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

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

		require.IsType(t, &api.TeamResponse{}, resp, helpers.MustMarshal(t, resp))
		created := resp.(*api.TeamResponse)
		assert.Equal(t, name, created.Name)
		assert.Equal(t, api.TeamStatusActive, created.Status)
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
			assert.IsType(t, &api.TeamResponse{}, resp, helpers.MustMarshal(t, resp))
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
				require.IsType(t, &api.TeamResponse{}, resp, helpers.MustMarshal(t, resp))

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
	t.Cleanup(func() {
		// Teams have no delete statement; they cascade with their project.
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

		params := api.GetTeamParams{
			TeamID: api.TeamID(team.ID),
		}

		resp, err := client.GetTeam(t.Context(), params)
		require.NoError(t, err)

		require.IsType(t, &api.TeamResponse{}, resp, helpers.MustMarshal(t, resp))
		got := resp.(*api.TeamResponse)
		assert.Equal(t, team.Name, got.Name)
		assert.Equal(t, api.TeamStatusActive, got.Status)
	})

	// A deactivated team is a tombstone: it is still readable, its status tells
	// it apart from an active one.
	t.Run("deactivated team", func(t *testing.T) {
		t.Parallel()

		team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
			ProjectID: project.ID,
			Name:      helpers.TeamName(),
		})
		require.NoError(t, err)
		_, err = harness.EnsureServiceDB(t).Statements().DeactivateTeam(t.Context(), project.ID, team.ID)
		require.NoError(t, err)

		params := api.GetTeamParams{
			TeamID: api.TeamID(team.ID),
		}

		resp, err := client.GetTeam(t.Context(), params)
		require.NoError(t, err)

		require.IsType(t, &api.TeamResponse{}, resp, helpers.MustMarshal(t, resp))
		got := resp.(*api.TeamResponse)
		assert.Equal(t, api.TeamStatusDeactivated, got.Status)
	})

	t.Run("error", func(t *testing.T) {
		t.Parallel()

		t.Run("non existing team", func(t *testing.T) {
			t.Parallel()

			params := api.GetTeamParams{
				TeamID: api.TeamID("does-not-exist"),
			}

			resp, err := client.GetTeam(t.Context(), params)
			require.NoError(t, err)

			require.IsType(t, &api.GetTeamNotFound{}, resp, helpers.MustMarshal(t, resp))
			notFound := resp.(*api.GetTeamNotFound)
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
			TeamID: api.TeamID(team.ID),
		}

		resp, err := client.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: api.NewOptString(name)}, params)
		require.NoError(t, err)

		require.IsType(t, &api.TeamResponse{}, resp, helpers.MustMarshal(t, resp))
		updated := resp.(*api.TeamResponse)
		assert.Equal(t, name, updated.Name)
		assert.Equal(t, api.TeamStatusActive, updated.Status)
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
			TeamID: api.TeamID(team.ID),
		}

		resp, err := client.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: api.NewOptString("  " + name + "  ")}, params)
		require.NoError(t, err)

		require.IsType(t, &api.TeamResponse{}, resp, helpers.MustMarshal(t, resp))
		updated := resp.(*api.TeamResponse)
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
			TeamID: api.TeamID(team.ID),
		}

		resp, err := client.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: api.NewOptString(name)}, params)
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
				TeamID: api.TeamID(team.ID),
			}

			resp, err := client.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: api.NewOptString("   ")}, params)
			require.NoError(t, err)

			require.IsType(t, &api.UpdateTeamBadRequest{}, resp, helpers.MustMarshal(t, resp))
			badRequest := resp.(*api.UpdateTeamBadRequest)
			assert.Equal(t, api.ErrorCode("team.name_invalid"), badRequest.Code)
		})

		t.Run("omitted name", func(t *testing.T) {
			t.Parallel()

			team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
				ProjectID: project.ID,
				Name:      helpers.TeamName(),
			})
			require.NoError(t, err)

			params := api.UpdateTeamParams{
				TeamID: api.TeamID(team.ID),
			}

			resp, err := client.UpdateTeam(t.Context(), &api.UpdateTeamRequest{}, params)
			require.NoError(t, err)

			require.IsType(t, &api.UpdateTeamBadRequest{}, resp, helpers.MustMarshal(t, resp))
			badRequest := resp.(*api.UpdateTeamBadRequest)
			assert.Equal(t, api.ErrorCode("team.name_invalid"), badRequest.Code)
		})

		t.Run("non existing team", func(t *testing.T) {
			t.Parallel()

			params := api.UpdateTeamParams{
				TeamID: api.TeamID("does-not-exist"),
			}

			resp, err := client.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: api.NewOptString(helpers.TeamName())}, params)
			require.NoError(t, err)

			require.IsType(t, &api.UpdateTeamNotFound{}, resp, helpers.MustMarshal(t, resp))
			notFound := resp.(*api.UpdateTeamNotFound)
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
			_, err = harness.EnsureServiceDB(t).Statements().DeactivateTeam(t.Context(), project.ID, team.ID)
			require.NoError(t, err)

			params := api.UpdateTeamParams{
				TeamID: api.TeamID(team.ID),
			}

			resp, err := client.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: api.NewOptString(helpers.TeamName())}, params)
			require.NoError(t, err)

			require.IsType(t, &api.UpdateTeamNotFound{}, resp, helpers.MustMarshal(t, resp))
			notFound := resp.(*api.UpdateTeamNotFound)
			assert.Equal(t, api.ErrorCode("team.team_not_found"), notFound.Code)
		})

		taken := helpers.TeamName()
		_, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
			ProjectID: project.ID,
			Name:      taken,
		})
		require.NoError(t, err)

		for _, tc := range []struct {
			name     string
			teamName string
		}{
			{"duplicate name", taken},
			{"duplicate name differing only in case", strings.ToUpper(taken)},
		} {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()

				team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
					ProjectID: project.ID,
					Name:      helpers.TeamName(),
				})
				require.NoError(t, err)

				params := api.UpdateTeamParams{
					TeamID: api.TeamID(team.ID),
				}

				resp, err := client.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: api.NewOptString(tc.teamName)}, params)
				require.NoError(t, err)

				require.IsType(t, &api.UpdateTeamConflict{}, resp, helpers.MustMarshal(t, resp))
				conflict := resp.(*api.UpdateTeamConflict)
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
					TeamID: api.TeamID("does-not-exist"),
				}

				_, err := client.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: api.NewOptString(tc.teamName)}, params)
				require.ErrorAs(t, err, new(*validate.Error))
			})
		}
	})
}

func TestDeleteTeam(t *testing.T) {
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

	createTeam := func(t *testing.T) *domain.Team {
		t.Helper()
		team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
			ProjectID: project.ID,
			Name:      helpers.TeamName(),
		})
		require.NoError(t, err)
		return team
	}

	deleteTeam := func(t *testing.T, teamID string) {
		t.Helper()
		resp, err := client.DeleteTeam(t.Context(), api.DeleteTeamParams{
			TeamID: api.TeamID(teamID),
		})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteTeamNoContent{}, resp, helpers.MustMarshal(t, resp))
	}

	teamStatus := func(t *testing.T, teamID string) api.TeamStatus {
		t.Helper()
		resp, err := client.GetTeam(t.Context(), api.GetTeamParams{
			TeamID: api.TeamID(teamID),
		})
		require.NoError(t, err)
		require.IsType(t, &api.TeamResponse{}, resp, helpers.MustMarshal(t, resp))
		return resp.(*api.TeamResponse).Status
	}

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		team := createTeam(t)
		deleteTeam(t, team.ID)
		assert.Equal(t, api.TeamStatusDeactivated, teamStatus(t, team.ID))
	})

	// Re-deleting must not write, so the tombstone keeps recording when the team
	// was deactivated rather than when delete was last called.
	t.Run("idempotent", func(t *testing.T) {
		t.Parallel()

		team := createTeam(t)
		deleteTeam(t, team.ID)

		deactivated, err := harness.EnsureTeamService(t).Get(t.Context(), project.ID, team.ID)
		require.NoError(t, err)

		deleteTeam(t, team.ID)

		again, err := harness.EnsureTeamService(t).Get(t.Context(), project.ID, team.ID)
		require.NoError(t, err)
		assert.Equal(t, deactivated.UpdatedAt, again.UpdatedAt)
		assert.Equal(t, api.TeamStatusDeactivated, teamStatus(t, team.ID))
	})

	// Reporting a missing team would let a caller holding team.delete without a
	// read scope enumerate team ids.
	t.Run("unknown team id succeeds", func(t *testing.T) {
		t.Parallel()

		deleteTeam(t, "does-not-exist")
	})

	// An id that fails the contract's pattern never reaches the handler, so it
	// keeps its 400 rather than joining the ids that answer 204. The generated
	// client validates team_id before it sends, so only a raw request gets there.
	t.Run("malformed team id", func(t *testing.T) {
		t.Parallel()

		for _, tc := range []struct {
			name   string
			teamID string
		}{
			{"disallowed character", "team.1"},
			{"escaped space", "team%20id"},
		} {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()

				req, err := http.NewRequestWithContext(t.Context(), http.MethodDelete,
					harness.EnsureTestServer(t).URL+"/teams/"+tc.teamID,
					nil,
				)
				require.NoError(t, err)
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
	})

	// A team that lives in another project (RSI hit, no foothold) is denied.
	t.Run("foreign project is denied", func(t *testing.T) {
		t.Parallel()

		other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		t.Cleanup(func() {
			_ = harness.EnsureServiceDB(t).Statements().DeleteProjectByID(context.Background(), other.ID)
		})
		foreignTeam, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
			ProjectID: other.ID,
			Name:      helpers.TeamName(),
		})
		require.NoError(t, err)

		resp, err := client.DeleteTeam(t.Context(), api.DeleteTeamParams{
			TeamID: api.TeamID(foreignTeam.ID),
		})
		require.NoError(t, err)

		require.IsType(t, &api.DeleteTeamForbidden{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("team.permission_denied"), resp.(*api.DeleteTeamForbidden).Code)
	})

	// The cascade itself is proven per dialect by the storage suite; this only
	// shows the endpoint reaches it rather than writing the team status alone.
	t.Run("cascades to lifecycle-owned users", func(t *testing.T) {
		t.Parallel()

		userSchemaURL := harness.CreateUserSchema(t, project, harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)

		team := createTeam(t)
		attr, err := domain.NewCreateAttribute("email", helpers.RandString(8)+"@example.com", domain.AttributeUniquenessUnspecified)
		require.NoError(t, err)

		userID := "user_" + helpers.RandString(8)
		users := harness.EnsureUserFixture(t)
		require.NoError(t, users.Create(t.Context(), &domain.CreateUser{
			ProjectID:               project.ID,
			SchemaURL:               userSchemaURL,
			ID:                      userID,
			LifecycleOwnerTeamID:    &team.ID,
			InitialMembershipTeamID: &team.ID,
			Attributes:              domain.CreateAttributes{*attr},
		}))

		deleteTeam(t, team.ID)

		user, err := users.GetByID(t.Context(), project.ID, userID)
		require.NoError(t, err)
		assert.Equal(t, domain.UserStatusDeactivated, user.Metadata.Status)

		membership, err := harness.EnsureServiceDB(t).Statements().GetTeamMembership(t.Context(), project.ID, team.ID, userID)
		require.NoError(t, err)
		assert.Equal(t, domain.MembershipStatusRemoved, membership.Status)
	})
}

func TestQueryTeams(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	t.Cleanup(func() {
		// Teams have no delete statement; they cascade with their project.
		_ = harness.EnsureServiceDB(t).Statements().DeleteProjectByID(context.Background(), project.ID)
	})

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	params := api.QueryTeamsParams{ProjectID: api.ProjectID(project.ID)}

	// A team in a second project must never surface in this project's results.
	otherProject, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = harness.EnsureServiceDB(t).Statements().DeleteProjectByID(context.Background(), otherProject.ID)
	})
	_, err = harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: otherProject.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)

	active, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)

	deactivated, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)
	_, err = harness.EnsureServiceDB(t).Statements().DeactivateTeam(t.Context(), project.ID, deactivated.ID)
	require.NoError(t, err)

	queryTeams := func(t *testing.T, req *api.QueryTeamsRequest) *api.QueryTeamsResponse {
		t.Helper()
		resp, err := client.QueryTeams(t.Context(), req, params)
		require.NoError(t, err)
		require.IsType(t, &api.QueryTeamsResponse{}, resp, helpers.MustMarshal(t, resp))
		return resp.(*api.QueryTeamsResponse)
	}

	byID := func(teams []api.TeamResponse) map[string]api.TeamResponse {
		out := make(map[string]api.TeamResponse, len(teams))
		for _, team := range teams {
			out[team.ID] = team
		}
		return out
	}

	t.Run("returns the project's teams with their status", func(t *testing.T) {
		got := byID(queryTeams(t, &api.QueryTeamsRequest{}).Teams)

		require.Contains(t, got, active.ID)
		assert.Equal(t, active.Name, got[active.ID].Name)
		assert.Equal(t, api.TeamStatusActive, got[active.ID].Status)
		assert.NotEmpty(t, got[active.ID].CreatedAt)
		assert.False(t, got[active.ID].UpdatedAt.Before(got[active.ID].CreatedAt))

		// A deactivated team is a tombstone, not a deletion: it stays listed,
		// its status tells it apart.
		require.Contains(t, got, deactivated.ID)
		assert.Equal(t, api.TeamStatusDeactivated, got[deactivated.ID].Status)

		// Only this project's teams: the other project created exactly one.
		assert.Len(t, got, 2)
	})

	t.Run("filters and sorts by createdAt", func(t *testing.T) {
		// A minute of slack absorbs the whole-second truncation RFC3339 applies.
		before := active.CreatedAt.Add(-time.Minute).Format(time.RFC3339)
		after := active.CreatedAt.Add(time.Minute).Format(time.RFC3339)

		createdAtFilter := func(op api.FilterOperation, value string) []api.QueryTeamsRequestFilterItem {
			return []api.QueryTeamsRequestFilterItem{{
				Field:     api.TeamFilterFieldCreatedAt,
				Operation: op,
				Value:     api.NewOptFilterValue(api.NewStringFilterValue(value)),
			}}
		}

		matched := queryTeams(t, &api.QueryTeamsRequest{
			Filter: createdAtFilter(api.FilterOperationGreaterThan, before),
		})
		assert.Len(t, matched.Teams, 2)

		none := queryTeams(t, &api.QueryTeamsRequest{
			Filter: createdAtFilter(api.FilterOperationGreaterThan, after),
		})
		assert.Empty(t, none.Teams)

		asc := queryTeams(t, &api.QueryTeamsRequest{
			Sorting: api.NewOptQueryTeamsRequestSorting(api.QueryTeamsRequestSorting{
				Field:     api.TeamFilterFieldCreatedAt,
				Direction: api.SortDirectionAsc,
			}),
		})
		desc := queryTeams(t, &api.QueryTeamsRequest{
			Sorting: api.NewOptQueryTeamsRequestSorting(api.QueryTeamsRequestSorting{
				Field:     api.TeamFilterFieldCreatedAt,
				Direction: api.SortDirectionDesc,
			}),
		})
		require.Len(t, asc.Teams, 2)
		require.Len(t, desc.Teams, 2)
		assert.Equal(t, asc.Teams[0].ID, desc.Teams[1].ID)
		assert.Equal(t, asc.Teams[1].ID, desc.Teams[0].ID)
	})

	t.Run("pages with the cursor token", func(t *testing.T) {
		req := &api.QueryTeamsRequest{Limit: api.NewOptLimit(1)}
		firstPage := queryTeams(t, req)
		require.Len(t, firstPage.Teams, 1)

		pageToken, ok := firstPage.NextPageToken.Get()
		require.True(t, ok, "a full page carries a cursor")

		req.PageToken = api.NewOptNilPageToken(pageToken)
		secondPage := queryTeams(t, req)
		require.Len(t, secondPage.Teams, 1)
		assert.NotEqual(t, firstPage.Teams[0].ID, secondPage.Teams[0].ID)

		lastToken, ok := secondPage.NextPageToken.Get()
		require.True(t, ok, "a full page carries a cursor even when it is the last one")
		req.PageToken = api.NewOptNilPageToken(lastToken)
		thirdPage := queryTeams(t, req)
		assert.Empty(t, thirdPage.Teams)
		assert.False(t, thirdPage.NextPageToken.IsSet())
	})

	t.Run("error", func(t *testing.T) {
		t.Parallel()

		requestInvalid := domain.ErrRequestInvalid()

		badRequests := []struct {
			name string
			req  *api.QueryTeamsRequest
		}{
			{
				name: "unparseable createdAt value",
				req: &api.QueryTeamsRequest{Filter: []api.QueryTeamsRequestFilterItem{{
					Field:     api.TeamFilterFieldCreatedAt,
					Operation: api.FilterOperationEquals,
					Value:     api.NewOptFilterValue(api.NewStringFilterValue("yesterday")),
				}}},
			},
			{
				name: "non-string createdAt value",
				req: &api.QueryTeamsRequest{Filter: []api.QueryTeamsRequestFilterItem{{
					Field:     api.TeamFilterFieldCreatedAt,
					Operation: api.FilterOperationEquals,
					Value:     api.NewOptFilterValue(api.NewBoolFilterValue(true)),
				}}},
			},
			{
				name: "malformed page token",
				req:  &api.QueryTeamsRequest{PageToken: api.NewOptNilPageToken("not-a-cursor")},
			},
		}

		for _, tc := range badRequests {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()

				resp, err := client.QueryTeams(t.Context(), tc.req, params)
				require.NoError(t, err)
				require.IsType(t, &api.QueryTeamsBadRequest{}, resp, helpers.MustMarshal(t, resp))
				assert.Equal(t, api.ErrorCode(requestInvalid.Code), resp.(*api.QueryTeamsBadRequest).Code)
			})
		}
	})
}

// TestUpdateTeamRawRequest sends raw bodies (e.g., from a curl request or from a
// non-generated SDK), which is the only way to reach the server-side length
// checks: the generated client rejects these bodies before sending them.
func TestUpdateTeamRawRequest(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = harness.EnsureServiceDB(t).Statements().DeleteProjectByID(context.Background(), project.ID)
	})

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)

	for _, tc := range []struct {
		name     string
		teamName string
	}{
		{"empty name", ""},
		{"name over the length limit", strings.Repeat("a", domain.TeamNameMaxLength+1)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			body := helpers.MustMarshal(t, api.UpdateTeamRequest{Name: api.NewOptString(tc.teamName)})
			req, err := http.NewRequestWithContext(t.Context(), http.MethodPatch,
				harness.EnsureTestServer(t).URL+"/teams/"+url.PathEscape(team.ID),
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
