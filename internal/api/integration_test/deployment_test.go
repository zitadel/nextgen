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
// real server, so the new shapes decode and the access check still runs
// first.
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

	t.Run("create by release id", func(t *testing.T) {
		resp, err := fixture.client.CreateDeployment(t.Context(),
			&api.CreateDeploymentRequest{
				ReleaseID: api.NewOptReleaseID(releaseID),
				Targets:   api.DeploymentTargetsRequest{"primary"},
			},
			api.CreateDeploymentParams{ProjectID: project})
		require.NoError(t, err)
		expectNotImplemented(t, resp)
	})

	t.Run("create by content hash", func(t *testing.T) {
		resp, err := fixture.client.CreateDeployment(t.Context(),
			&api.CreateDeploymentRequest{
				ContentHash: api.NewOptReleaseContentHash(created.(*api.CreateReleaseCreated).ContentHash),
				Targets:     api.DeploymentTargetsRequest{"https://app.acme.com"},
			},
			api.CreateDeploymentParams{ProjectID: project})
		require.NoError(t, err)
		expectNotImplemented(t, resp)
	})

	t.Run("rollback", func(t *testing.T) {
		resp, err := fixture.client.RollbackDeployment(t.Context(),
			api.NewOptRollbackDeploymentRequest(api.RollbackDeploymentRequest{
				Message: api.NewOptString("phone_number broke sign-up"),
			}),
			api.RollbackDeploymentParams{
				ProjectID:    project,
				DeploymentID: "dep_01KX4SB9C8E1F0N9WD3P2E4YM5",
			})
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

	t.Run("list the live view of one origin", func(t *testing.T) {
		resp, err := fixture.client.ListDeployments(t.Context(), api.ListDeploymentsParams{
			ProjectID: project,
			Origin:    api.NewOptOrigin("https://app.acme.com"),
			Live:      api.NewOptBool(true),
		})
		require.NoError(t, err)
		expectNotImplemented(t, resp)
	})

	t.Run("create to preview URLs", func(t *testing.T) {
		resp, err := fixture.client.CreateDeployment(t.Context(),
			&api.CreateDeploymentRequest{
				ReleaseID: api.NewOptReleaseID(releaseID),
				Targets:   api.DeploymentTargetsRequest{"https://acme-git-sso-acmeinc.vercel.app"},
				TTL:       api.NewOptPreviewTTL("168h"),
			},
			api.CreateDeploymentParams{ProjectID: project})
		require.NoError(t, err)
		expectNotImplemented(t, resp)
	})

	t.Run("list previews", func(t *testing.T) {
		resp, err := fixture.client.ListPreviews(t.Context(), api.ListPreviewsParams{ProjectID: project})
		require.NoError(t, err)
		expectNotImplemented(t, resp)
	})

	t.Run("remove a preview", func(t *testing.T) {
		resp, err := fixture.client.RemovePreview(t.Context(),
			&api.RemovePreviewRequest{Origin: "https://acme-git-sso-acmeinc.vercel.app"},
			api.RemovePreviewParams{ProjectID: project})
		require.NoError(t, err)
		expectNotImplemented(t, resp)
	})
}

// TestDeploymentsCheckAccessBeforeNotImplemented pins the order the handlers
// promise: a caller without access learns that before it learns the operation
// is not served yet.
func TestDeploymentsCheckAccessBeforeNotImplemented(t *testing.T) {
	t.Parallel()

	mine := newReleaseFixture(t)
	theirs := newReleaseFixture(t)
	project := api.ProjectID(mine.project)

	expectError := func(t *testing.T, resp any, wantStatus int, wantCode string) {
		t.Helper()
		status, code, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, wantStatus, status)
		assert.Equal(t, wantCode, code)
	}

	t.Run("create in another project", func(t *testing.T) {
		resp, err := theirs.client.CreateDeployment(t.Context(),
			&api.CreateDeploymentRequest{
				ReleaseID: api.NewOptReleaseID("rel_01KX5N7C9D2E7F0N9WD3P2E4YM6"),
				Targets:   api.DeploymentTargetsRequest{"primary"},
			},
			api.CreateDeploymentParams{ProjectID: project})
		require.NoError(t, err)
		expectError(t, resp, http.StatusNotFound, domain.ErrEnvironmentProjectNotFound().Code)
	})

	t.Run("get in another project", func(t *testing.T) {
		resp, err := theirs.client.GetDeploymentById(t.Context(), api.GetDeploymentByIdParams{
			ProjectID:    project,
			DeploymentID: "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
		})
		require.NoError(t, err)
		expectError(t, resp, http.StatusNotFound, domain.ErrDeploymentNotFound().Code)
	})

	t.Run("list in another project", func(t *testing.T) {
		resp, err := theirs.client.ListDeployments(t.Context(), api.ListDeploymentsParams{
			ProjectID: project,
		})
		require.NoError(t, err)
		expectError(t, resp, http.StatusNotFound, domain.ErrDeploymentNotFound().Code)
	})

	t.Run("expand release without release.read", func(t *testing.T) {
		owner, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetScopedTokenOnApiClient(t, client, owner, "deployment.read")

		resp, err := client.ListDeployments(t.Context(), api.ListDeploymentsParams{
			ProjectID: api.ProjectID(owner.ID),
			Expand:    []api.DeploymentExpand{api.DeploymentExpandRelease},
		})
		require.NoError(t, err)
		expectError(t, resp, http.StatusForbidden, domain.ErrDeploymentPermissionDenied().Code)
	})
}
