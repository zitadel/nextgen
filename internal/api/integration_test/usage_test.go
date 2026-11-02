//go:build postgres_integration || spanner_integration

package integration_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// TestUsageReads reads a project's usage over HTTP: no team before its claim,
// then its claiming team and how far its counts are sealed. It writes no
// rollups, which no project delete would remove; the cursor it moves goes
// with the project.
func TestUsageReads(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	october := time.Date(2026, time.October, 1, 0, 0, 0, 0, time.UTC)
	read := func(t *testing.T, params api.GetUsageParams) api.GetUsageRes {
		t.Helper()
		params.ProjectID = api.ProjectID(project.ID)
		resp, err := client.GetUsage(t.Context(), params)
		require.NoError(t, err)
		return resp
	}
	month := api.GetUsageParams{From: october, To: october.AddDate(0, 1, 0)}

	t.Run("an unclaimed project names no team", func(t *testing.T) {
		resp := read(t, month)
		require.IsType(t, &api.UsageResponseHeaders{}, resp, helpers.MustMarshal(t, resp))
		usage := resp.(*api.UsageResponseHeaders)
		assert.Equal(t, "private, no-store", usage.CacheControl.Value)
		assert.Empty(t, usage.Response.Data)
		assert.True(t, usage.Response.TeamID.Null)
		assert.True(t, usage.Response.SealedThrough.Null)
	})

	platformID := harness.EnsurePlatformProject(t).ID
	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{ProjectID: platformID, Name: helpers.TeamName()})
	require.NoError(t, err)
	t.Cleanup(func() { _ = harness.EnsureTeamService(t).Delete(context.Background(), platformID, team.ID) })
	harness.SeedOwningTeam(t, project.ID, team.ID)
	counted := october.Add(36*time.Hour + 20*time.Minute)
	_, err = harness.EnsureServiceDB(t).Statements().AdvanceUsageCursor(t.Context(), nil,
		domain.UsageCursor{ProjectID: project.ID, CountedBefore: counted})
	require.NoError(t, err)

	t.Run("a claimed project names its team and its sealed hours", func(t *testing.T) {
		resp := read(t, month)
		require.IsType(t, &api.UsageResponseHeaders{}, resp, helpers.MustMarshal(t, resp))
		usage := resp.(*api.UsageResponseHeaders).Response
		assert.Empty(t, usage.Data, "nothing counted yet")
		assert.Equal(t, api.TeamID(team.ID), usage.TeamID.Value)
		assert.Equal(t, october.Add(36*time.Hour), usage.SealedThrough.Value.UTC(), "sealed through the cursor's hour")
	})

	t.Run("a range off its boundaries", func(t *testing.T) {
		resp := read(t, api.GetUsageParams{From: october.Add(time.Hour), To: october.AddDate(0, 0, 1)})
		// A declared status decodes into its own type, which carries no status.
		require.IsType(t, &api.GetUsageBadRequest{}, resp, helpers.MustMarshal(t, resp))
		_, code, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, domain.ErrUsageInvalid(nil).Code, code)
	})

	t.Run("another project's usage", func(t *testing.T) {
		resp, err := client.GetUsage(t.Context(), api.GetUsageParams{
			ProjectID: "proj_01KX5N7C9D2E7F0N9WD3P2E4YM6", From: october, To: october.AddDate(0, 1, 0),
		})
		require.NoError(t, err)
		status, code, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, http.StatusNotFound, status)
		assert.Equal(t, domain.ErrUsageNotFound().Code, code)
	})
}
