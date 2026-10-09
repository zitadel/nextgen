//go:build postgres_integration || spanner_integration

package integration_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

// TestDeploymentsNotImplemented pins the deployment operations to 501 until
// the deployment service deploys to targets. Each request goes through the
// real server, so the access check still runs first.
func TestDeploymentsNotImplemented(t *testing.T) {
	t.Parallel()

	fixture := newReleaseFixture(t)
	created := fixture.create(t, &api.CreateReleaseRequest{Pointers: fixture.pointers()})
	require.IsType(t, &api.CreateReleaseCreated{}, created, helpers.MustMarshal(t, created))
	releaseID := created.(*api.CreateReleaseCreated).ID
	project := api.ProjectID(fixture.project)

	expectNotImplemented := func(t *testing.T, resp any) {
		t.Helper()
		status, code, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, http.StatusNotImplemented, status)
		assert.Equal(t, domain.ErrNotImplemented().Code, code)
	}

	t.Run("create", func(t *testing.T) {
		resp, err := fixture.client.CreateDeployment(t.Context(),
			&api.CreateDeploymentRequest{
				Environment: "prod",
				ReleaseID:   releaseID,
			},
			api.CreateDeploymentParams{ProjectID: project})
		require.NoError(t, err)
		expectNotImplemented(t, resp)
	})

	t.Run("get", func(t *testing.T) {
		resp, err := fixture.client.GetDeploymentById(t.Context(), api.GetDeploymentByIdParams{
			ProjectID:    project,
			DeploymentID: "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
		})
		require.NoError(t, err)
		expectNotImplemented(t, resp)
	})

	t.Run("list", func(t *testing.T) {
		resp, err := fixture.client.ListDeployments(t.Context(), api.ListDeploymentsParams{
			ProjectID: project,
		})
		require.NoError(t, err)
		expectNotImplemented(t, resp)
	})
}
