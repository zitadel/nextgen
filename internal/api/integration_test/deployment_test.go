//go:build postgres_integration || spanner_integration

package integration_test

import (
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

// TestPreviews seeds previews through the deployment service, since a
// deployment over HTTP still answers 501, then lists and removes them.
func TestPreviews(t *testing.T) {
	t.Parallel()

	fixture := newReleaseFixture(t)
	created := fixture.create(t, &api.CreateReleaseRequest{Pointers: fixture.pointers()})
	require.IsType(t, &api.CreateReleaseCreated{}, created, helpers.MustMarshal(t, created))
	project := api.ProjectID(fixture.project)
	origins := []string{"https://acme-git-sso-acmeinc.vercel.app", "https://acme-k3x9v2-acmeinc.vercel.app"}

	_, err := service.NewDeploymentService(harness.EnsureServiceDB(t)).Create(t.Context(), service.CreateDeploymentInput{
		ProjectID:  fixture.project,
		ReleaseID:  string(created.(*api.CreateReleaseCreated).ID),
		OriginKind: domain.DeploymentOriginKindPreview,
		Origins:    origins,
		Reason:     domain.DeploymentReasonDeploy,
		PreviewTTL: 168 * time.Hour,
	})
	require.NoError(t, err)

	list := func(t *testing.T) []string {
		t.Helper()
		resp, err := fixture.client.ListPreviews(t.Context(), api.ListPreviewsParams{ProjectID: project})
		require.NoError(t, err)
		require.IsType(t, &api.ListPreviewsResponse{}, resp, helpers.MustMarshal(t, resp))
		var listed []string
		for _, p := range resp.(*api.ListPreviewsResponse).Previews {
			assert.True(t, p.ExpiresAt.After(p.CreatedAt))
			listed = append(listed, string(p.Origin))
		}
		return listed
	}
	remove := func(t *testing.T, origin string) {
		t.Helper()
		resp, err := fixture.client.RemovePreview(t.Context(),
			&api.RemovePreviewRequest{Origin: api.Origin(origin)},
			api.RemovePreviewParams{ProjectID: project})
		require.NoError(t, err)
		require.IsType(t, &api.RemovePreviewNoContent{}, resp, helpers.MustMarshal(t, resp))
	}

	assert.ElementsMatch(t, origins, list(t))

	remove(t, origins[0])
	assert.Equal(t, origins[1:], list(t))

	// Again, with nothing left to remove.
	remove(t, origins[0])
	assert.Equal(t, origins[1:], list(t))
}

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

	t.Run("variables", func(t *testing.T) {
		resp, err := fixture.client.GetDeploymentVariables(t.Context(), api.GetDeploymentVariablesParams{
			ProjectID:    project,
			DeploymentID: "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
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
