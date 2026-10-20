//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
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

// postDeployment posts body to /deployments and returns the status and error code,
// so an error is checked without decoding it into the declared response shape.
func (f releaseFixture) postDeployment(t *testing.T, body string) (int, string) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
		harness.EnsureTestServer(t).URL+"/deployments?project_id="+url.QueryEscape(f.project),
		strings.NewReader(body),
	)
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+f.client.Token())

	resp, err := harness.EnsureHttpClient(t).Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	var parsed struct {
		Code string `json:"code"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&parsed))
	return resp.StatusCode, parsed.Code
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
		status, code := fixture.postDeployment(t, `{"release_id":"`+string(fixture.otherRelease(t))+
			`","targets":["primary"],"expected_deployment_id":"`+string(first.ID)+`"}`)
		assert.Equal(t, http.StatusConflict, status)
		assert.Equal(t, domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}).Code, code)

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
		body       string
		wantStatus int
		wantCode   string
	}{
		"both release_id and content_hash": {
			body:       `{"release_id":"` + string(releaseID) + `","content_hash":"` + string(fixture.release.ContentHash) + `","targets":["primary"]}`,
			wantStatus: http.StatusBadRequest, wantCode: domain.ErrDeploymentInvalid().Code,
		},
		"a ttl for primary origins": {
			body:       `{"release_id":"` + string(releaseID) + `","targets":["primary"],"ttl":"1h"}`,
			wantStatus: http.StatusBadRequest, wantCode: domain.ErrDeploymentInvalid().Code,
		},
		"a ttl for an exact primary origin": {
			body:       `{"release_id":"` + string(releaseID) + `","targets":["` + appOrigin + `"],"ttl":"1h"}`,
			wantStatus: http.StatusBadRequest, wantCode: domain.ErrDeploymentInvalid().Code,
		},
		"a ttl for mixed targets": {
			body:       `{"release_id":"` + string(releaseID) + `","targets":["primary","` + previewOrigin + `"],"ttl":"1h"}`,
			wantStatus: http.StatusBadRequest, wantCode: domain.ErrDeploymentInvalid().Code,
		},
		"primary and a preview URL mixed": {
			body:       `{"release_id":"` + string(releaseID) + `","targets":["primary","` + previewOrigin + `"]}`,
			wantStatus: http.StatusBadRequest, wantCode: domain.ErrDeploymentInvalid().Code,
		},
		"an exact primary origin": {
			body:       `{"release_id":"` + string(releaseID) + `","targets":["` + appOrigin + `"]}`,
			wantStatus: http.StatusBadRequest, wantCode: domain.ErrDeploymentInvalid().Code,
		},
		// Deploying to preview URLs lands on top of this.
		"a preview URL": {
			body:       `{"release_id":"` + string(releaseID) + `","targets":["` + previewOrigin + `"]}`,
			wantStatus: http.StatusNotImplemented, wantCode: domain.ErrNotImplemented().Code,
		},
		"an unknown release": {
			body:       `{"release_id":"rel_01KX5N7C9D2E7F0N9WD3P2E4YM6","targets":["primary"]}`,
			wantStatus: http.StatusNotFound, wantCode: domain.ErrReleaseNotFound().Code,
		},
	} {
		t.Run(name, func(t *testing.T) {
			status, code := fixture.postDeployment(t, tc.body)
			assert.Equal(t, tc.wantStatus, status)
			assert.Equal(t, tc.wantCode, code)
		})
	}

	t.Run("a project with no primary origin", func(t *testing.T) {
		bare := newReleaseFixture(t)
		created := bare.create(t, &api.CreateReleaseRequest{Pointers: bare.pointers()})
		require.IsType(t, &api.CreateReleaseCreated{}, created, helpers.MustMarshal(t, created))
		status, code := bare.postDeployment(t, `{"release_id":"`+string(created.(*api.CreateReleaseCreated).ID)+`","targets":["primary"]}`)
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, domain.ErrDeploymentInvalid().Code, code)
	})
}

// TestRollbackDeployment deploys two releases to primary and rolls back to
// the first: a new primary deployment of its release, with reason rollback
// naming it. Rolling back to what is live already changes nothing.
func TestRollbackDeployment(t *testing.T) {
	t.Parallel()

	fixture := newDeploymentFixture(t)
	project := api.ProjectID(fixture.project)

	first := fixture.deploy(t, fixture.release.ID)
	require.IsType(t, &api.CreateDeploymentCreated{}, first, helpers.MustMarshal(t, first))
	good := first.(*api.CreateDeploymentCreated)
	second := fixture.deploy(t, fixture.otherRelease(t))
	require.IsType(t, &api.CreateDeploymentCreated{}, second, helpers.MustMarshal(t, second))
	bad := second.(*api.CreateDeploymentCreated)

	rollback := func(t *testing.T, id api.DeploymentID, body api.RollbackDeploymentRequest) api.RollbackDeploymentRes {
		t.Helper()
		resp, err := fixture.client.RollbackDeployment(t.Context(), api.NewOptRollbackDeploymentRequest(body),
			api.RollbackDeploymentParams{ProjectID: project, DeploymentID: id})
		require.NoError(t, err)
		return resp
	}

	t.Run("a guard naming another deployment", func(t *testing.T) {
		resp := rollback(t, good.ID, api.RollbackDeploymentRequest{ExpectedDeploymentID: api.NewOptDeploymentID(good.ID)})
		require.IsType(t, &api.DeploymentConflict{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, bad.ID, resp.(*api.DeploymentConflict).DeploymentGuardConflict.Details.Deployment.Value.ID)
	})

	t.Run("re-deploys the release to every primary origin", func(t *testing.T) {
		resp := rollback(t, good.ID, api.RollbackDeploymentRequest{
			Message:              api.NewOptString("phone_number broke sign-up"),
			ExpectedDeploymentID: api.NewOptDeploymentID(bad.ID),
		})
		require.IsType(t, &api.RollbackDeploymentCreated{}, resp, helpers.MustMarshal(t, resp))
		got := resp.(*api.RollbackDeploymentCreated)
		assert.NotEqual(t, good.ID, got.ID)
		assert.Equal(t, fixture.release.ID, got.ReleaseID)
		assert.Equal(t, api.DeploymentKindPrimary, got.Kind)
		assert.Equal(t, api.DeploymentStatusLive, got.Status)
		assert.Equal(t, origins(good.Targets), origins(got.Targets))
		assert.Equal(t, api.DeploymentReasonRollback, got.Metadata.Reason)
		assert.Equal(t, good.ID, got.Metadata.RollbackTo.Value)
		assert.Equal(t, "phone_number broke sign-up", got.Metadata.Message.Value)

		read, err := fixture.client.GetDeploymentById(t.Context(), api.GetDeploymentByIdParams{ProjectID: project, DeploymentID: bad.ID})
		require.NoError(t, err)
		require.IsType(t, &api.Deployment{}, read, helpers.MustMarshal(t, read))
		assert.Equal(t, api.DeploymentStatusInactive, read.(*api.Deployment).Status)
	})

	t.Run("again changes nothing", func(t *testing.T) {
		resp := rollback(t, good.ID, api.RollbackDeploymentRequest{})
		require.IsType(t, &api.RollbackDeploymentOK{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, fixture.release.ID, resp.(*api.RollbackDeploymentOK).ReleaseID)
	})

	t.Run("a deployment to preview URLs", func(t *testing.T) {
		preview, err := service.NewDeploymentService(harness.EnsureServiceDB(t)).Create(t.Context(), service.CreateDeploymentInput{
			ProjectID:  fixture.project,
			ReleaseID:  string(fixture.release.ID),
			OriginKind: domain.DeploymentOriginKindPreview,
			Origins:    []string{previewOrigin},
			Reason:     domain.DeploymentReasonDeploy,
			PreviewTTL: time.Hour,
		})
		require.NoError(t, err)
		resp := rollback(t, api.DeploymentID(preview.Deployment.ID), api.RollbackDeploymentRequest{})
		// The declared 400 decodes into a typed body, which carries no status.
		require.IsType(t, &api.ErrorDetails{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode(domain.ErrDeploymentInvalid().Code), resp.(*api.ErrorDetails).Code)
	})

	t.Run("an unknown deployment", func(t *testing.T) {
		assertAuthzError(t, rollback(t, "dep_01KX4SB9C8E1F0N9WD3P2E4YM5", api.RollbackDeploymentRequest{}), domain.ErrDeploymentNotFound().Code)
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
