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
)

const (
	appOrigin     = "https://app.acme.com"
	wwwOrigin     = "https://www.acme.com"
	previewOrigin = "https://acme-git-sso-acmeinc.vercel.app"
	otherPreview  = "https://acme-k3x9v2-acmeinc.vercel.app"
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
		_, err := harness.EnsureProjectService(t).AddOrigin(t.Context(), fixture.project, origin)
		require.NoError(t, err)
	}
	created := fixture.create(t, &api.CreateReleaseRequest{Pointers: fixture.pointers()})
	require.IsType(t, &api.CreateReleaseCreated{}, created, helpers.MustMarshal(t, created))
	return deploymentFixture{releaseFixture: fixture, release: created.(*api.CreateReleaseCreated)}
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

func (f deploymentFixture) deploy(t *testing.T, req *api.CreateDeploymentRequest) api.CreateDeploymentRes {
	t.Helper()
	resp, err := f.client.CreateDeployment(t.Context(), req, api.CreateDeploymentParams{ProjectID: api.ProjectID(f.project)})
	require.NoError(t, err)
	return resp
}

func (f deploymentFixture) created(t *testing.T, req *api.CreateDeploymentRequest) *api.CreateDeploymentCreated {
	t.Helper()
	resp := f.deploy(t, req)
	require.IsType(t, &api.CreateDeploymentCreated{}, resp, helpers.MustMarshal(t, resp))
	return resp.(*api.CreateDeploymentCreated)
}

// postRaw posts body to path and returns the status and error code, so an
// error is checked without decoding it into the declared response shape.
func (f deploymentFixture) postRaw(t *testing.T, path, body string) (int, string) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
		harness.EnsureTestServer(t).URL+path+"?project_id="+url.QueryEscape(f.project),
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

func TestCreateDeployment(t *testing.T) {
	t.Parallel()

	fixture := newDeploymentFixture(t)
	releaseID := fixture.release.ID

	first := fixture.created(t, &api.CreateDeploymentRequest{
		ReleaseID: api.NewOptReleaseID(releaseID),
		Targets:   api.DeploymentTargetsRequest{"primary"},
		Message:   api.NewOptString("add phone_number"),
	})

	t.Run("primary expands to the primary origins", func(t *testing.T) {
		assert.Equal(t, releaseID, first.ReleaseID)
		assert.Equal(t, []string{appOrigin, wwwOrigin}, origins(first.Targets))
		assert.False(t, first.Targets[0].ExpiresAt.Set)
		assert.Equal(t, api.DeploymentReasonDeploy, first.Metadata.Reason)
		assert.Equal(t, "add phone_number", first.Metadata.Message.Value)
	})

	t.Run("the same release again is a no-op", func(t *testing.T) {
		resp := fixture.deploy(t, &api.CreateDeploymentRequest{
			ReleaseID: api.NewOptReleaseID(releaseID),
			Targets:   api.DeploymentTargetsRequest{"primary"},
		})
		require.IsType(t, &api.CreateDeploymentOK{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, first.ID, resp.(*api.CreateDeploymentOK).ID)
	})

	t.Run("a stale guard conflicts", func(t *testing.T) {
		status, code := fixture.postRaw(t, "/deployments", `{"release_id":"`+string(fixture.otherRelease(t))+
			`","targets":["`+appOrigin+`"],"expected_deployment_id":"dep_01KX5N7C9D2E7F0N9WD3P2E4YM6"}`)
		assert.Equal(t, http.StatusConflict, status)
		assert.Equal(t, domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}).Code, code)
	})

	for name, tc := range map[string]struct {
		body       string
		wantStatus int
		wantCode   string
	}{
		// Naming the release by its digest lands with #1574.
		"by content hash": {
			body:       `{"content_hash":"` + string(fixture.release.ContentHash) + `","targets":["primary"]}`,
			wantStatus: http.StatusNotImplemented, wantCode: domain.ErrNotImplemented().Code,
		},
		"a ttl for primary origins": {
			body:       `{"release_id":"` + string(releaseID) + `","targets":["primary"],"ttl":"1h"}`,
			wantStatus: http.StatusBadRequest, wantCode: domain.ErrDeploymentInvalid(nil, nil).Code,
		},
		"primary and preview mixed": {
			body:       `{"release_id":"` + string(releaseID) + `","targets":["primary","` + previewOrigin + `"]}`,
			wantStatus: http.StatusBadRequest, wantCode: domain.ErrDeploymentInvalid(nil, nil).Code,
		},
		"an origin the project does not allow": {
			body:       `{"release_id":"` + string(releaseID) + `","targets":["https://evil.example"]}`,
			wantStatus: http.StatusForbidden, wantCode: domain.ErrProjectOriginNotAllowed("").Code,
		},
		"an unknown release": {
			body:       `{"release_id":"rel_01KX5N7C9D2E7F0N9WD3P2E4YM6","targets":["primary"]}`,
			wantStatus: http.StatusNotFound, wantCode: domain.ErrReleaseNotFound().Code,
		},
	} {
		t.Run(name, func(t *testing.T) {
			status, code := fixture.postRaw(t, "/deployments", tc.body)
			assert.Equal(t, tc.wantStatus, status)
			assert.Equal(t, tc.wantCode, code)
		})
	}
}

func TestPreviews(t *testing.T) {
	t.Parallel()

	fixture := newDeploymentFixture(t)
	project := api.ProjectID(fixture.project)

	before := time.Now()
	deployed := fixture.created(t, &api.CreateDeploymentRequest{
		ReleaseID: api.NewOptReleaseID(fixture.release.ID),
		Targets:   api.DeploymentTargetsRequest{previewOrigin, otherPreview},
		TTL:       api.NewOptPreviewTTL("168h"),
	})
	require.Len(t, deployed.Targets, 2)
	for _, target := range deployed.Targets {
		require.True(t, target.ExpiresAt.Set)
		assert.WithinDuration(t, before.Add(168*time.Hour), target.ExpiresAt.Value, time.Minute)
	}

	t.Run("a deploy to the same URLs always writes", func(t *testing.T) {
		again := fixture.created(t, &api.CreateDeploymentRequest{
			ReleaseID: api.NewOptReleaseID(fixture.release.ID),
			Targets:   api.DeploymentTargetsRequest{previewOrigin, otherPreview},
		})
		assert.NotEqual(t, deployed.ID, again.ID)
	})

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

	t.Run("list and remove", func(t *testing.T) {
		assert.ElementsMatch(t, []string{previewOrigin, otherPreview}, list(t))

		remove(t, previewOrigin)
		assert.Equal(t, []string{otherPreview}, list(t))

		// Again, with nothing left to remove.
		remove(t, previewOrigin)
		assert.Equal(t, []string{otherPreview}, list(t))
	})
}

func TestDeploymentReads(t *testing.T) {
	t.Parallel()

	fixture := newDeploymentFixture(t)
	project := api.ProjectID(fixture.project)
	releaseID := fixture.release.ID

	deployed := fixture.created(t, &api.CreateDeploymentRequest{
		ReleaseID: api.NewOptReleaseID(releaseID),
		Targets:   api.DeploymentTargetsRequest{previewOrigin},
		Message:   api.NewOptString("add phone_number"),
	})

	list := func(t *testing.T, params api.ListDeploymentsParams) []api.Deployment {
		t.Helper()
		params.ProjectID = project
		resp, err := fixture.client.ListDeployments(t.Context(), params)
		require.NoError(t, err)
		require.IsType(t, &api.ListDeploymentsResponse{}, resp, helpers.MustMarshal(t, resp))
		return resp.(*api.ListDeploymentsResponse).Deployments
	}

	t.Run("get", func(t *testing.T) {
		resp, err := fixture.client.GetDeploymentById(t.Context(), api.GetDeploymentByIdParams{
			ProjectID: project, DeploymentID: deployed.ID,
		})
		require.NoError(t, err)
		require.IsType(t, &api.Deployment{}, resp, helpers.MustMarshal(t, resp))
		got := resp.(*api.Deployment)
		assert.Equal(t, releaseID, got.ReleaseID)
		assert.Equal(t, []string{previewOrigin}, origins(got.Targets))
		assert.Equal(t, "add phone_number", got.Metadata.Message.Value)
		assert.False(t, got.Release.Set)
	})

	t.Run("get an unknown id", func(t *testing.T) {
		resp, err := fixture.client.GetDeploymentById(t.Context(), api.GetDeploymentByIdParams{
			ProjectID: project, DeploymentID: "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
		})
		require.NoError(t, err)
		assertAuthzError(t, resp, domain.ErrDeploymentNotFound().Code)
	})

	t.Run("list the history", func(t *testing.T) {
		got := list(t, api.ListDeploymentsParams{})
		require.Len(t, got, 1)
		assert.Equal(t, deployed.ID, got[0].ID)
	})

	t.Run("list the live view of one origin", func(t *testing.T) {
		got := list(t, api.ListDeploymentsParams{Origin: api.NewOptOrigin(previewOrigin), Live: api.NewOptBool(true)})
		require.Len(t, got, 1)
		assert.Equal(t, deployed.ID, got[0].ID)
	})

	t.Run("list the live view of an origin serving nothing", func(t *testing.T) {
		assert.Empty(t, list(t, api.ListDeploymentsParams{Origin: api.NewOptOrigin(appOrigin), Live: api.NewOptBool(true)}))
	})

	t.Run("list with the release embedded", func(t *testing.T) {
		got := list(t, api.ListDeploymentsParams{Expand: []api.DeploymentExpand{api.DeploymentExpandRelease}})
		require.Len(t, got, 1)
		require.True(t, got[0].Release.Set)
		assert.Equal(t, releaseID, got[0].Release.Value.ID)
	})
}

// TestDeploymentsNotImplemented pins rollback and the frozen-variables read
// to 501 until they land (#1781 for the variables).
func TestDeploymentsNotImplemented(t *testing.T) {
	t.Parallel()

	fixture := newReleaseFixture(t)
	project := api.ProjectID(fixture.project)
	expectNotImplemented := func(t *testing.T, resp any) {
		t.Helper()
		status, code, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, http.StatusNotImplemented, status)
		assert.Equal(t, domain.ErrNotImplemented().Code, code)
	}

	t.Run("rollback", func(t *testing.T) {
		resp, err := fixture.client.RollbackDeployment(t.Context(),
			api.NewOptRollbackDeploymentRequest(api.RollbackDeploymentRequest{
				Message: api.NewOptString("phone_number broke sign-up"),
			}),
			api.RollbackDeploymentParams{ProjectID: project, DeploymentID: "dep_01KX4SB9C8E1F0N9WD3P2E4YM5"})
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
}

// TestDeploymentsCheckAccess pins that a caller without access to the project
// learns nothing about its deployments.
func TestDeploymentsCheckAccess(t *testing.T) {
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
