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

func (f deploymentFixture) rollback(t *testing.T, deploymentID api.DeploymentID, req api.RollbackDeploymentRequest) api.RollbackDeploymentRes {
	t.Helper()
	resp, err := f.client.RollbackDeployment(t.Context(), api.NewOptRollbackDeploymentRequest(req),
		api.RollbackDeploymentParams{ProjectID: api.ProjectID(f.project), DeploymentID: deploymentID})
	require.NoError(t, err)
	return resp
}

// TestRollbackDeployment rolls back to an earlier primary deployment. The
// subtests share one project and run in order: each builds on what the one
// before deployed.
func TestRollbackDeployment(t *testing.T) {
	t.Parallel()

	fixture := newDeploymentFixture(t)
	resp := fixture.deploy(t, fixture.release.ID)
	require.IsType(t, &api.CreateDeploymentCreated{}, resp, helpers.MustMarshal(t, resp))
	first := resp.(*api.CreateDeploymentCreated)
	resp = fixture.deploy(t, fixture.otherRelease(t))
	require.IsType(t, &api.CreateDeploymentCreated{}, resp, helpers.MustMarshal(t, resp))
	second := resp.(*api.CreateDeploymentCreated)

	var rolledBack *api.RollbackDeploymentCreated
	t.Run("re-deploys the release with rollback_to naming the deployment", func(t *testing.T) {
		resp := fixture.rollback(t, first.ID, api.RollbackDeploymentRequest{
			Message:              api.NewOptString("phone_number broke sign-up"),
			ExpectedDeploymentID: api.NewOptDeploymentID(second.ID),
		})
		require.IsType(t, &api.RollbackDeploymentCreated{}, resp, helpers.MustMarshal(t, resp))
		rolledBack = resp.(*api.RollbackDeploymentCreated)
		assert.Equal(t, fixture.release.ID, rolledBack.ReleaseID)
		assert.Equal(t, api.DeploymentKindPrimary, rolledBack.Kind)
		assert.Equal(t, api.DeploymentStatusLive, rolledBack.Status)
		assert.Equal(t, []string{appOrigin, wwwOrigin}, origins(rolledBack.Targets))
		assert.Equal(t, api.DeploymentReasonRollback, rolledBack.Metadata.Reason)
		rollbackTo, _ := rolledBack.Metadata.RollbackTo.Get()
		assert.Equal(t, first.ID, rollbackTo)
		message, _ := rolledBack.Metadata.Message.Get()
		assert.Equal(t, "phone_number broke sign-up", message)
	})

	t.Run("again is a no-op", func(t *testing.T) {
		resp := fixture.rollback(t, first.ID, api.RollbackDeploymentRequest{})
		require.IsType(t, &api.RollbackDeploymentOK{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, rolledBack.ID, resp.(*api.RollbackDeploymentOK).ID)
	})

	t.Run("a stale guard conflicts with the newest primary deployment", func(t *testing.T) {
		resp := fixture.rollback(t, second.ID, api.RollbackDeploymentRequest{
			ExpectedDeploymentID: api.NewOptDeploymentID(second.ID),
		})
		require.IsType(t, &api.DeploymentConflict{}, resp, helpers.MustMarshal(t, resp))
		newest := resp.(*api.DeploymentConflict).DeploymentGuardConflict.Details.Deployment
		require.False(t, newest.Null)
		assert.Equal(t, rolledBack.ID, newest.Value.ID)
	})

	t.Run("covers a primary origin added since", func(t *testing.T) {
		fixture.addOrigin(t, domain.Origin{Pattern: "https://acme.com", Kind: domain.OriginKindPrimary})
		resp := fixture.rollback(t, second.ID, api.RollbackDeploymentRequest{})
		require.IsType(t, &api.RollbackDeploymentCreated{}, resp, helpers.MustMarshal(t, resp))
		got := resp.(*api.RollbackDeploymentCreated)
		assert.Equal(t, second.ReleaseID, got.ReleaseID)
		assert.Equal(t, []string{"https://acme.com", appOrigin, wwwOrigin}, origins(got.Targets))
	})

	t.Run("an unknown deployment", func(t *testing.T) {
		resp := fixture.rollback(t, "dep_01KX4SB9C8E1F0N9WD3P2E4YM5", api.RollbackDeploymentRequest{})
		assertAuthzStatus(t, resp, http.StatusNotFound, domain.ErrDeploymentNotFound().Code)
	})

	t.Run("a project with no primary origin", func(t *testing.T) {
		alone := deploymentFixture{releaseFixture: newReleaseFixture(t)}
		alone.addOrigin(t, domain.Origin{Pattern: appOrigin, Kind: domain.OriginKindPrimary})
		created := alone.create(t, &api.CreateReleaseRequest{Pointers: alone.pointers()})
		require.IsType(t, &api.CreateReleaseCreated{}, created, helpers.MustMarshal(t, created))
		resp := alone.deploy(t, created.(*api.CreateReleaseCreated).ID)
		require.IsType(t, &api.CreateDeploymentCreated{}, resp, helpers.MustMarshal(t, resp))
		require.NoError(t, harness.EnsureProjectService(t).RemoveOrigin(t.Context(), alone.project, appOrigin))

		rollback := alone.rollback(t, resp.(*api.CreateDeploymentCreated).ID, api.RollbackDeploymentRequest{})
		assertAuthzError(t, rollback, domain.ErrDeploymentInvalid().Code)
	})
}

// TestRevokeRelease revokes a release once nothing serves it, refuses while
// an origin does, and keeps a revoked release out of every deploy.
func TestRevokeRelease(t *testing.T) {
	t.Parallel()

	fixture := newDeploymentFixture(t)
	project := api.ProjectID(fixture.project)
	revoke := func(t *testing.T, id api.ReleaseID) api.RevokeReleaseRes {
		t.Helper()
		resp, err := fixture.client.RevokeRelease(t.Context(), api.RevokeReleaseParams{ProjectID: project, ReleaseID: id})
		require.NoError(t, err)
		return resp
	}

	deployed := fixture.deploy(t, fixture.release.ID)
	require.IsType(t, &api.CreateDeploymentCreated{}, deployed, helpers.MustMarshal(t, deployed))
	live := deployed.(*api.CreateDeploymentCreated)

	t.Run("refused while the primary origins serve it", func(t *testing.T) {
		resp := revoke(t, fixture.release.ID)
		require.IsType(t, &api.RevokeReleaseConflict{}, resp, helpers.MustMarshal(t, resp))
		conflict := resp.(*api.RevokeReleaseConflict)
		assert.Equal(t, api.ErrorCode(domain.ErrReleaseInUse(domain.ReleaseInUseDetails{}).Code), conflict.Code)
		var served []string
		for _, origin := range conflict.Details.Origins {
			assert.Equal(t, live.ID, origin.DeploymentID)
			served = append(served, origin.Origin.String())
		}
		assert.Equal(t, origins(live.Targets), served)
	})

	other := fixture.otherRelease(t)
	replaced := fixture.deploy(t, other)
	require.IsType(t, &api.CreateDeploymentCreated{}, replaced, helpers.MustMarshal(t, replaced))

	t.Run("refused while a live preview serves it", func(t *testing.T) {
		preview, err := service.NewDeploymentService(harness.EnsureServiceDB(t)).Create(t.Context(), service.CreateDeploymentInput{
			ProjectID:  fixture.project,
			ReleaseID:  string(fixture.release.ID),
			OriginKind: domain.DeploymentOriginKindPreview,
			Origins:    []string{previewOrigin},
			Reason:     domain.DeploymentReasonDeploy,
			PreviewTTL: time.Hour,
		})
		require.NoError(t, err)
		resp := revoke(t, fixture.release.ID)
		require.IsType(t, &api.RevokeReleaseConflict{}, resp, helpers.MustMarshal(t, resp))
		conflict := resp.(*api.RevokeReleaseConflict)
		require.Len(t, conflict.Details.Origins, 1)
		assert.Equal(t, previewOrigin, conflict.Details.Origins[0].Origin.String())
		assert.Equal(t, api.DeploymentID(preview.Deployment.ID), conflict.Details.Origins[0].DeploymentID)

		// The preview moves on to the other release, so nothing serves it.
		_, err = service.NewDeploymentService(harness.EnsureServiceDB(t)).Create(t.Context(), service.CreateDeploymentInput{
			ProjectID:  fixture.project,
			ReleaseID:  string(other),
			OriginKind: domain.DeploymentOriginKindPreview,
			Origins:    []string{previewOrigin},
			Reason:     domain.DeploymentReasonDeploy,
			PreviewTTL: time.Hour,
		})
		require.NoError(t, err)
	})

	var revokedAt time.Time
	t.Run("revokes once nothing serves it", func(t *testing.T) {
		resp := revoke(t, fixture.release.ID)
		require.IsType(t, &api.Release{}, resp, helpers.MustMarshal(t, resp))
		got := resp.(*api.Release)
		assert.Equal(t, fixture.release.ID, got.ID)
		require.False(t, got.RevokedAt.Null, helpers.MustMarshal(t, got))
		assert.WithinDuration(t, time.Now(), got.RevokedAt.Value, time.Minute)
		revokedAt = got.RevokedAt.Value

		read, err := fixture.client.GetReleaseById(t.Context(), api.GetReleaseByIdParams{ProjectID: project, ReleaseID: fixture.release.ID})
		require.NoError(t, err)
		require.IsType(t, &api.Release{}, read, helpers.MustMarshal(t, read))
		assert.Equal(t, revokedAt, read.(*api.Release).RevokedAt.Value)
	})

	t.Run("again keeps the first revocation", func(t *testing.T) {
		resp := revoke(t, fixture.release.ID)
		require.IsType(t, &api.Release{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, revokedAt, resp.(*api.Release).RevokedAt.Value)
	})

	t.Run("a revoked release does not deploy", func(t *testing.T) {
		resp := fixture.deploy(t, fixture.release.ID)
		require.IsType(t, &api.DeploymentConflict{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ReleaseRevokedConflictDeploymentConflict, resp.(*api.DeploymentConflict).Type)
	})

	t.Run("the history keeps its deployments", func(t *testing.T) {
		read, err := fixture.client.GetDeploymentById(t.Context(), api.GetDeploymentByIdParams{ProjectID: project, DeploymentID: live.ID})
		require.NoError(t, err)
		require.IsType(t, &api.Deployment{}, read, helpers.MustMarshal(t, read))
		assert.Equal(t, api.DeploymentStatusInactive, read.(*api.Deployment).Status)
	})

	t.Run("an unknown release", func(t *testing.T) {
		status, code, _, ok := errorResponseParts(t, revoke(t, "rel_01KX5N7C9D2E7F0N9WD3P2E4YM6"))
		require.True(t, ok)
		assert.Equal(t, http.StatusNotFound, status)
		assert.Equal(t, domain.ErrReleaseNotFound().Code, code)
	})

	t.Run("another project's release", func(t *testing.T) {
		// Own token and project; the release is another project's, and the
		// lookup is scoped to the project, so it reads as unknown.
		theirs := newDeploymentFixture(t)
		status, code, _, ok := errorResponseParts(t, revoke(t, theirs.release.ID))
		require.True(t, ok)
		assert.Equal(t, http.StatusNotFound, status)
		assert.Equal(t, domain.ErrReleaseNotFound().Code, code)
	})
}

// TestDeploymentReads deploys two releases to primary and reads them back:
// only the newer one is live, and the live view follows the project's
// primary origins.
func TestDeploymentReads(t *testing.T) {
	t.Parallel()

	fixture := newDeploymentFixture(t)
	project := api.ProjectID(fixture.project)

	firstResp := fixture.deploy(t, fixture.release.ID)
	require.IsType(t, &api.CreateDeploymentCreated{}, firstResp, helpers.MustMarshal(t, firstResp))
	first := firstResp.(*api.CreateDeploymentCreated)
	secondRelease := fixture.otherRelease(t)
	secondResp := fixture.deploy(t, secondRelease)
	require.IsType(t, &api.CreateDeploymentCreated{}, secondResp, helpers.MustMarshal(t, secondResp))
	second := secondResp.(*api.CreateDeploymentCreated)

	get := func(t *testing.T, id api.DeploymentID) *api.Deployment {
		t.Helper()
		resp, err := fixture.client.GetDeploymentById(t.Context(), api.GetDeploymentByIdParams{ProjectID: project, DeploymentID: id})
		require.NoError(t, err)
		require.IsType(t, &api.Deployment{}, resp, helpers.MustMarshal(t, resp))
		return resp.(*api.Deployment)
	}
	list := func(t *testing.T, params api.ListDeploymentsParams) []api.Deployment {
		t.Helper()
		params.ProjectID = project
		resp, err := fixture.client.ListDeployments(t.Context(), params)
		require.NoError(t, err)
		require.IsType(t, &api.ListDeploymentsResponse{}, resp, helpers.MustMarshal(t, resp))
		return resp.(*api.ListDeploymentsResponse).Deployments
	}
	ids := func(deployments []api.Deployment) []api.DeploymentID {
		out := make([]api.DeploymentID, len(deployments))
		for i, d := range deployments {
			out[i] = d.ID
		}
		return out
	}

	t.Run("get carries kind and status", func(t *testing.T) {
		older := get(t, first.ID)
		assert.Equal(t, api.DeploymentKindPrimary, older.Kind)
		assert.Equal(t, api.DeploymentStatusInactive, older.Status)
		assert.Equal(t, []string{appOrigin, wwwOrigin}, origins(older.Targets))
		assert.False(t, older.Release.Set)

		newer := get(t, second.ID)
		assert.Equal(t, api.DeploymentStatusLive, newer.Status)
		assert.Equal(t, secondRelease, newer.ReleaseID)
	})

	t.Run("get an unknown id", func(t *testing.T) {
		resp, err := fixture.client.GetDeploymentById(t.Context(), api.GetDeploymentByIdParams{
			ProjectID: project, DeploymentID: "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
		})
		require.NoError(t, err)
		status, code, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, http.StatusNotFound, status)
		assert.Equal(t, domain.ErrDeploymentNotFound().Code, code)
	})

	t.Run("the history, newest first, with each status", func(t *testing.T) {
		got := list(t, api.ListDeploymentsParams{})
		assert.Equal(t, []api.DeploymentID{second.ID, first.ID}, ids(got))
		assert.Equal(t, api.DeploymentStatusLive, got[0].Status)
		assert.Equal(t, api.DeploymentStatusInactive, got[1].Status)
	})

	t.Run("the history of one origin", func(t *testing.T) {
		assert.Equal(t, []api.DeploymentID{second.ID, first.ID}, ids(list(t, api.ListDeploymentsParams{Origin: api.NewOptOrigin(wwwOrigin)})))
	})

	t.Run("the live view is the newest primary deployment", func(t *testing.T) {
		got := list(t, api.ListDeploymentsParams{Live: api.NewOptBool(true)})
		assert.Equal(t, []api.DeploymentID{second.ID}, ids(got))
		assert.Equal(t, api.DeploymentStatusLive, got[0].Status)
	})

	t.Run("embeds the release", func(t *testing.T) {
		got := list(t, api.ListDeploymentsParams{Expand: []api.DeploymentExpand{api.DeploymentExpandRelease}})
		require.Len(t, got, 2)
		require.True(t, got[0].Release.Set)
		assert.Equal(t, secondRelease, got[0].Release.Value.ID)
	})

	// Runs last: it adds a primary origin to the project.
	t.Run("a primary origin added since serves nothing", func(t *testing.T) {
		const added = "https://acme.com"
		fixture.addOrigin(t, domain.Origin{Pattern: added, Kind: domain.OriginKindPrimary})
		assert.Empty(t, list(t, api.ListDeploymentsParams{Origin: api.NewOptOrigin(added), Live: api.NewOptBool(true)}))
		assert.Equal(t, []api.DeploymentID{second.ID},
			ids(list(t, api.ListDeploymentsParams{Origin: api.NewOptOrigin(appOrigin), Live: api.NewOptBool(true)})))
	})

	t.Run("a removed primary origin drops out of the live view", func(t *testing.T) {
		require.NoError(t, harness.EnsureProjectService(t).RemoveOrigin(t.Context(), fixture.project, wwwOrigin))
		got := list(t, api.ListDeploymentsParams{Live: api.NewOptBool(true)})
		require.Len(t, got, 1)
		assert.Equal(t, []string{appOrigin}, origins(got[0].Targets))
		assert.Equal(t, []string{appOrigin, wwwOrigin}, origins(get(t, second.ID).Targets), "the record keeps its origins")
	})

	t.Run("a live page of one ends at the primary deployment when nothing follows", func(t *testing.T) {
		resp, err := fixture.client.ListDeployments(t.Context(), api.ListDeploymentsParams{
			ProjectID: project, Live: api.NewOptBool(true), Limit: api.NewOptLimit(1),
		})
		require.NoError(t, err)
		require.IsType(t, &api.ListDeploymentsResponse{}, resp, helpers.MustMarshal(t, resp))
		page := resp.(*api.ListDeploymentsResponse)
		assert.Equal(t, []api.DeploymentID{second.ID}, ids(page.Deployments))
		_, more := page.NextPageToken.Get()
		assert.False(t, more)
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

	t.Run("variables", func(t *testing.T) {
		resp, err := fixture.client.GetDeploymentVariables(t.Context(), api.GetDeploymentVariablesParams{
			ProjectID:    project,
			DeploymentID: "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
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
