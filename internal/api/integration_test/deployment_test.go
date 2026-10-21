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

const (
	appOrigin     = "https://app.acme.com"
	wwwOrigin     = "https://www.acme.com"
	previewOrigin = "https://acme-git-sso-acmeinc.vercel.app"
)

// deploymentFixture is a project with two primary origins, a preview pattern
// and one release.
type deploymentFixture struct {
	releaseFixture
	release *api.CreateReleaseCreated
}

func newDeploymentFixture(t *testing.T) deploymentFixture {
	t.Helper()
	fixture := newReleaseFixture(t)
	for _, origin := range []domain.Origin{
		{Pattern: appOrigin, Kind: domain.OriginKindPrimary},
		{Pattern: wwwOrigin, Kind: domain.OriginKindPrimary},
		{Pattern: "https://*-acmeinc.vercel.app", Kind: domain.OriginKindPreview},
	} {
		fixture.addOrigin(t, origin)
	}
	created := fixture.create(t, &api.CreateReleaseRequest{Pointers: fixture.pointers()})
	require.IsType(t, &api.CreateReleaseCreated{}, created, helpers.MustMarshal(t, created))
	return deploymentFixture{releaseFixture: fixture, release: created.(*api.CreateReleaseCreated)}
}

func (f releaseFixture) addOrigin(t *testing.T, origin domain.Origin) {
	t.Helper()
	_, err := harness.EnsureProjectService(t).AddOrigin(t.Context(), f.project, origin)
	require.NoError(t, err)
}

// otherRelease creates a second release with different content.
func (f deploymentFixture) otherRelease(t *testing.T) api.ReleaseID {
	t.Helper()
	other := f.releaseFixture
	other.brandingID = publishBranding(t, f.client, f.project, `<zl-page-shell>v2 {% mandatory_gates %}</zl-page-shell>`)
	created := other.create(t, &api.CreateReleaseRequest{Pointers: other.pointers()})
	require.IsType(t, &api.CreateReleaseCreated{}, created, helpers.MustMarshal(t, created))
	return created.(*api.CreateReleaseCreated).ID
}

func (f deploymentFixture) deploy(t *testing.T, releaseID api.ReleaseID) api.CreateDeploymentRes {
	t.Helper()
	resp, err := f.client.CreateDeployment(t.Context(), &api.CreateDeploymentRequest{
		ReleaseID: api.NewOptReleaseID(releaseID),
		Targets:   api.DeploymentTargetsRequest{"primary"},
	}, api.CreateDeploymentParams{ProjectID: api.ProjectID(f.project)})
	require.NoError(t, err)
	return resp
}

// refused asserts the create answered with the response type of its status
// and the error code.
func refused(t *testing.T, resp api.CreateDeploymentRes, wantType api.CreateDeploymentRes, wantCode string) {
	t.Helper()
	require.IsType(t, wantType, resp, helpers.MustMarshal(t, resp))
	assertAuthzError(t, resp, wantCode)
}

func (f releaseFixture) createDeployment(t *testing.T, req *api.CreateDeploymentRequest) api.CreateDeploymentRes {
	t.Helper()
	resp, err := f.client.CreateDeployment(t.Context(), req, api.CreateDeploymentParams{ProjectID: api.ProjectID(f.project)})
	require.NoError(t, err)
	return resp
}

func origins(targets []api.DeploymentTarget) []string {
	out := make([]string, len(targets))
	for i, target := range targets {
		out[i] = string(target.Origin)
	}
	return out
}

// TestCreateDeployment deploys to primary origins. The subtests share one
// project and run in order: each builds on what the one before deployed.
func TestCreateDeployment(t *testing.T) {
	t.Parallel()

	fixture := newDeploymentFixture(t)
	releaseID := fixture.release.ID

	resp := fixture.deploy(t, releaseID)
	require.IsType(t, &api.CreateDeploymentCreated{}, resp, helpers.MustMarshal(t, resp))
	first := resp.(*api.CreateDeploymentCreated)

	t.Run("primary covers every primary origin", func(t *testing.T) {
		assert.Equal(t, releaseID, first.ReleaseID)
		assert.Equal(t, api.DeploymentKindPrimary, first.Kind)
		assert.Equal(t, api.DeploymentStatusLive, first.Status)
		assert.Equal(t, []string{appOrigin, wwwOrigin}, origins(first.Targets))
		assert.Equal(t, api.DeploymentReasonDeploy, first.Metadata.Reason)
	})

	t.Run("the same release again is a no-op", func(t *testing.T) {
		resp := fixture.deploy(t, releaseID)
		require.IsType(t, &api.CreateDeploymentOK{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, first.ID, resp.(*api.CreateDeploymentOK).ID)
	})

	t.Run("a primary origin added since makes a new deployment", func(t *testing.T) {
		fixture.addOrigin(t, domain.Origin{Pattern: "https://acme.com", Kind: domain.OriginKindPrimary})
		resp := fixture.deploy(t, releaseID)
		require.IsType(t, &api.CreateDeploymentCreated{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, []string{"https://acme.com", appOrigin, wwwOrigin}, origins(resp.(*api.CreateDeploymentCreated).Targets))
	})

	t.Run("a matching guard deploys", func(t *testing.T) {
		latest := fixture.deploy(t, releaseID)
		require.IsType(t, &api.CreateDeploymentOK{}, latest, helpers.MustMarshal(t, latest))
		resp, err := fixture.client.CreateDeployment(t.Context(), &api.CreateDeploymentRequest{
			ReleaseID:            api.NewOptReleaseID(fixture.otherRelease(t)),
			Targets:              api.DeploymentTargetsRequest{"primary"},
			ExpectedDeploymentID: api.NewOptDeploymentID(latest.(*api.CreateDeploymentOK).ID),
		}, api.CreateDeploymentParams{ProjectID: api.ProjectID(fixture.project)})
		require.NoError(t, err)
		require.IsType(t, &api.CreateDeploymentCreated{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("reason rollback without rollback_to", func(t *testing.T) {
		resp, err := fixture.client.CreateDeployment(t.Context(), &api.CreateDeploymentRequest{
			ReleaseID: api.NewOptReleaseID(fixture.otherRelease(t)),
			Targets:   api.DeploymentTargetsRequest{"primary"},
			Reason:    api.NewOptDeploymentReason(api.DeploymentReasonRollback),
		}, api.CreateDeploymentParams{ProjectID: api.ProjectID(fixture.project)})
		require.NoError(t, err)
		require.IsType(t, &api.CreateDeploymentCreated{}, resp, helpers.MustMarshal(t, resp))
		got := resp.(*api.CreateDeploymentCreated)
		assert.Equal(t, api.DeploymentReasonRollback, got.Metadata.Reason)
		_, linked := got.Metadata.RollbackTo.Get()
		assert.False(t, linked, "rollback_to stays null")
	})

	t.Run("a stale guard conflicts with the deployment it replaces", func(t *testing.T) {
		resp, err := fixture.client.CreateDeployment(t.Context(), &api.CreateDeploymentRequest{
			ReleaseID:            api.NewOptReleaseID(releaseID),
			Targets:              api.DeploymentTargetsRequest{"primary"},
			ExpectedDeploymentID: api.NewOptDeploymentID(first.ID),
		}, api.CreateDeploymentParams{ProjectID: api.ProjectID(fixture.project)})
		require.NoError(t, err)
		require.IsType(t, &api.DeploymentConflict{}, resp, helpers.MustMarshal(t, resp))
		replaced := resp.(*api.DeploymentConflict).DeploymentGuardConflict.Details.Deployment
		require.False(t, replaced.Null)
		assert.NotEqual(t, first.ID, replaced.Value.ID)
		assert.Equal(t, api.DeploymentKindPrimary, replaced.Value.Kind)
		assert.Equal(t, api.DeploymentStatusLive, replaced.Value.Status)
	})

	for name, tc := range map[string]struct {
		req      *api.CreateDeploymentRequest
		wantType api.CreateDeploymentRes
		wantCode string
	}{
		"both release_id and content_hash": {
			req: &api.CreateDeploymentRequest{
				ReleaseID:   api.NewOptReleaseID(releaseID),
				ContentHash: api.NewOptReleaseContentHash(fixture.release.ContentHash),
				Targets:     api.DeploymentTargetsRequest{"primary"},
			},
			wantType: &api.CreateDeploymentBadRequest{}, wantCode: domain.ErrDeploymentInvalid().Code,
		},
		"a ttl for primary origins": {
			req: &api.CreateDeploymentRequest{
				ReleaseID: api.NewOptReleaseID(releaseID),
				Targets:   api.DeploymentTargetsRequest{"primary"},
				TTL:       api.NewOptPreviewTTL("1h"),
			},
			wantType: &api.CreateDeploymentBadRequest{}, wantCode: domain.ErrDeploymentInvalid().Code,
		},
		"a ttl for an exact primary origin": {
			req: &api.CreateDeploymentRequest{
				ReleaseID: api.NewOptReleaseID(releaseID),
				Targets:   api.DeploymentTargetsRequest{appOrigin},
				TTL:       api.NewOptPreviewTTL("1h"),
			},
			wantType: &api.CreateDeploymentBadRequest{}, wantCode: domain.ErrDeploymentInvalid().Code,
		},
		"a ttl for mixed targets": {
			req: &api.CreateDeploymentRequest{
				ReleaseID: api.NewOptReleaseID(releaseID),
				Targets:   api.DeploymentTargetsRequest{"primary", previewOrigin},
				TTL:       api.NewOptPreviewTTL("1h"),
			},
			wantType: &api.CreateDeploymentBadRequest{}, wantCode: domain.ErrDeploymentInvalid().Code,
		},
		"primary and a preview URL mixed": {
			req: &api.CreateDeploymentRequest{
				ReleaseID: api.NewOptReleaseID(releaseID),
				Targets:   api.DeploymentTargetsRequest{"primary", previewOrigin},
			},
			wantType: &api.CreateDeploymentBadRequest{}, wantCode: domain.ErrDeploymentInvalid().Code,
		},
		"an exact primary origin": {
			req: &api.CreateDeploymentRequest{
				ReleaseID: api.NewOptReleaseID(releaseID),
				Targets:   api.DeploymentTargetsRequest{appOrigin},
			},
			wantType: &api.CreateDeploymentBadRequest{}, wantCode: domain.ErrDeploymentInvalid().Code,
		},
		// Deploying to preview URLs lands on top of this.
		"a preview URL": {
			req: &api.CreateDeploymentRequest{
				ReleaseID: api.NewOptReleaseID(releaseID),
				Targets:   api.DeploymentTargetsRequest{previewOrigin},
			},
			wantType: &api.CreateDeploymentErrorResponseStatusCode{}, wantCode: domain.ErrNotImplemented().Code,
		},
		"an unknown release": {
			req: &api.CreateDeploymentRequest{
				ReleaseID: api.NewOptReleaseID("rel_01KX5N7C9D2E7F0N9WD3P2E4YM6"),
				Targets:   api.DeploymentTargetsRequest{"primary"},
			},
			wantType: &api.CreateDeploymentNotFound{}, wantCode: domain.ErrReleaseNotFound().Code,
		},
	} {
		t.Run(name, func(t *testing.T) {
			refused(t, fixture.createDeployment(t, tc.req), tc.wantType, tc.wantCode)
		})
	}

	t.Run("a project with no primary origin", func(t *testing.T) {
		withoutOrigins := newReleaseFixture(t)
		created := withoutOrigins.create(t, &api.CreateReleaseRequest{Pointers: withoutOrigins.pointers()})
		require.IsType(t, &api.CreateReleaseCreated{}, created, helpers.MustMarshal(t, created))
		resp := withoutOrigins.createDeployment(t, &api.CreateDeploymentRequest{
			ReleaseID: api.NewOptReleaseID(created.(*api.CreateReleaseCreated).ID),
			Targets:   api.DeploymentTargetsRequest{"primary"},
		})
		refused(t, resp, &api.CreateDeploymentBadRequest{}, domain.ErrDeploymentInvalid().Code)
	})
}

// TestDeploymentsNotImplemented pins the deployment operations not served
// yet to 501. Each request goes through the
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
		// A declared 404 decodes into a typed body, which carries no status.
		assertAuthzError(t, resp, domain.ErrEnvironmentProjectNotFound().Code)
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
