//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
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

// deploymentAllowlist is the allowlist every deployment fixture starts with:
// two primaries, one preview wildcard.
var deploymentAllowlist = []domain.AllowedOrigin{
	{Pattern: "https://app.acme.test", Kind: domain.OriginKindPrimary},
	{Pattern: "https://www.acme.test", Kind: domain.OriginKindPrimary},
	{Pattern: "https://*-acme.vercel.app", Kind: domain.OriginKindPreview},
}

// deploymentFixture is a release fixture plus one assembled release: the
// smallest thing a deployment can make live.
type deploymentFixture struct {
	releaseFixture
	releaseID string
}

func newDeploymentFixture(t *testing.T) deploymentFixture {
	t.Helper()
	fixture := newReleaseFixtureWithOrigins(t, deploymentAllowlist)
	resp := fixture.create(t, &api.CreateReleaseRequest{Pointers: fixture.pointers()})
	require.IsType(t, &api.CreateReleaseCreated{}, resp, helpers.MustMarshal(t, resp))
	return deploymentFixture{
		releaseFixture: fixture,
		releaseID:      string(resp.(*api.CreateReleaseCreated).ID),
	}
}

// newRelease assembles another release with a distinct pinned set — a fresh
// branding revision — since the content hash resolves an identical set to the
// release that already pins it.
func (f deploymentFixture) newRelease(t *testing.T) string {
	t.Helper()
	brandingID := publishBranding(t, f.client, f.project,
		`<zl-page-shell class="v2">{% mandatory_gates %}</zl-page-shell>`)
	pointers := f.pointers()
	for i := range pointers {
		if pointers[i].Kind == api.ReleasePointerKindBranding {
			pointers[i].RevisionID = brandingID
		}
	}
	resp := f.create(t, &api.CreateReleaseRequest{Pointers: pointers})
	require.IsType(t, &api.CreateReleaseCreated{}, resp, helpers.MustMarshal(t, resp))
	return string(resp.(*api.CreateReleaseCreated).ID)
}

func (f deploymentFixture) deploy(t *testing.T, req *api.CreateDeploymentRequest) api.CreateDeploymentRes {
	t.Helper()
	resp, err := f.client.CreateDeployment(t.Context(), req, api.CreateDeploymentParams{
		ProjectID: api.ProjectID(f.project),
	})
	require.NoError(t, err)
	return resp
}

func (f deploymentFixture) mustDeploy(t *testing.T, req *api.CreateDeploymentRequest) api.DeployResponse {
	t.Helper()
	resp := f.deploy(t, req)
	require.IsType(t, &api.CreateDeploymentCreated{}, resp, helpers.MustMarshal(t, resp))
	return api.DeployResponse(*resp.(*api.CreateDeploymentCreated))
}

func (f deploymentFixture) list(t *testing.T, params api.ListDeploymentsParams) []api.Deployment {
	t.Helper()
	params.ProjectID = api.ProjectID(f.project)
	resp, err := f.client.ListDeployments(t.Context(), params)
	require.NoError(t, err)
	require.IsType(t, &api.ListDeploymentsResponse{}, resp, helpers.MustMarshal(t, resp))
	return resp.(*api.ListDeploymentsResponse).Deployments
}

// live is the newest row per target, keyed by origin.
func (f deploymentFixture) live(t *testing.T) map[string]api.Deployment {
	t.Helper()
	rows := f.list(t, api.ListDeploymentsParams{Live: api.NewOptBool(true)})
	byOrigin := make(map[string]api.Deployment, len(rows))
	for _, row := range rows {
		byOrigin[row.Origin] = row
	}
	return byOrigin
}

func (f deploymentFixture) setVariables(t *testing.T, appliesTo api.VariableAppliesTo, body api.UpdateVariablesRequest) {
	t.Helper()
	resp, err := f.client.UpdateVariables(t.Context(), body, api.UpdateVariablesParams{
		ProjectID: api.ProjectID(f.project),
		AppliesTo: api.NewOptVariableAppliesTo(appliesTo),
	})
	require.NoError(t, err)
	require.IsType(t, &api.Variables{}, resp, helpers.MustMarshal(t, resp))
}

func (f deploymentFixture) frozen(t *testing.T, deploymentID api.DeploymentID) api.Variables {
	t.Helper()
	resp, err := f.client.GetDeploymentVariables(t.Context(), api.GetDeploymentVariablesParams{
		ProjectID:    api.ProjectID(f.project),
		DeploymentID: deploymentID,
	})
	require.NoError(t, err)
	require.IsType(t, &api.Variables{}, resp, helpers.MustMarshal(t, resp))
	return *resp.(*api.Variables)
}

// TestDeployments covers the deployments surface: one deploy fans out over
// the targets it names under one deploy id, the live view is the newest row
// per target, and the log keeps every row.
func TestDeployments(t *testing.T) {
	t.Parallel()

	fixture := newDeploymentFixture(t)
	fixture.setVariables(t, api.VariableAppliesToAll, api.UpdateVariablesRequest{
		"HOST": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("acme.test")),
	})

	deployed := fixture.mustDeploy(t, &api.CreateDeploymentRequest{
		Release: fixture.releaseID,
		Targets: []string{service.TargetDefault, service.TargetPrimary},
		Message: api.NewOptString("hotfix for the login outage"),
	})

	t.Run("primary expands to every primary origin under one deploy id", func(t *testing.T) {
		assert.True(t, domain.PrefixDeploy.Matches(deployed.DeployID), "deploy id %q is not dpl_-prefixed", deployed.DeployID)
		assert.Equal(t, fixture.releaseID, string(deployed.ReleaseID))
		assert.Equal(t, []string{"", "https://app.acme.test", "https://www.acme.test"}, deployed.Targets)
		require.Len(t, deployed.Deployments, 3)
		for _, row := range deployed.Deployments {
			assert.True(t, domain.PrefixDeployment.Matches(string(row.ID)))
			assert.Equal(t, deployed.DeployID, row.DeployID)
			assert.Equal(t, api.NewOptDeploymentReason(api.DeploymentReasonDeploy), row.Metadata.Reason)
			message, _ := row.Metadata.Message.Get()
			assert.Equal(t, "hotfix for the login outage", message)
			assert.True(t, row.Metadata.DeployedBy.IsNull(), "a project secret names no user")
			assert.Equal(t, api.DeploymentMetadataDeployedByTypeService, row.Metadata.DeployedByType.Value)
		}
	})

	t.Run("every row froze the store's values", func(t *testing.T) {
		for _, row := range deployed.Deployments {
			frozen := fixture.frozen(t, row.ID)
			assert.Equal(t, api.NewVariableScalarVariable(api.NewStringVariableScalar("acme.test")), frozen["HOST"])
		}
	})

	t.Run("the live view is the newest row per target", func(t *testing.T) {
		live := fixture.live(t)
		require.Len(t, live, 3)
		assert.Equal(t, fixture.releaseID, string(live[""].ReleaseID))
		assert.Equal(t, fixture.releaseID, string(live["https://app.acme.test"].ReleaseID))
		assert.True(t, live[""].ExpiresAt.IsNull() || !live[""].ExpiresAt.Set, "a primary never expires")
	})

	t.Run("re-deploying what every target serves writes nothing", func(t *testing.T) {
		resp := fixture.deploy(t, &api.CreateDeploymentRequest{
			Release: fixture.releaseID,
			Targets: []string{service.TargetDefault, service.TargetPrimary},
			Message: api.NewOptString("a different message entirely"),
		})
		require.IsType(t, &api.CreateDeploymentOK{}, resp, helpers.MustMarshal(t, resp))
		reused := api.DeployResponse(*resp.(*api.CreateDeploymentOK))
		assert.Equal(t, deployed.DeployID, reused.DeployID, "the answer is the deploy that made it live")
		assert.Len(t, fixture.list(t, api.ListDeploymentsParams{}), 3, "nothing was written")
	})

	t.Run("a changed value is a new deploy of the same release", func(t *testing.T) {
		fixture.setVariables(t, api.VariableAppliesToAll, api.UpdateVariablesRequest{
			"HOST": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("new.acme.test")),
		})
		redeployed := fixture.mustDeploy(t, &api.CreateDeploymentRequest{
			Release: fixture.releaseID,
			Targets: []string{service.TargetDefault},
		})
		require.Len(t, redeployed.Deployments, 1)
		assert.NotEqual(t, deployed.DeployID, redeployed.DeployID)
		frozen := fixture.frozen(t, redeployed.Deployments[0].ID)
		assert.Equal(t, api.NewVariableScalarVariable(api.NewStringVariableScalar("new.acme.test")), frozen["HOST"])
		// The first deploy's rows keep what they froze.
		assert.Equal(t, api.NewVariableScalarVariable(api.NewStringVariableScalar("acme.test")),
			fixture.frozen(t, deployed.Deployments[0].ID)["HOST"])
	})

	t.Run("one target's history is filtered by origin, newest first", func(t *testing.T) {
		rows := fixture.list(t, api.ListDeploymentsParams{Origin: api.NewOptString("")})
		require.Len(t, rows, 2)
		assert.NotEqual(t, deployed.DeployID, rows[0].DeployID)
		assert.Equal(t, deployed.DeployID, rows[1].DeployID)
		for _, row := range rows {
			assert.Equal(t, "", row.Origin)
		}
	})

	t.Run("one deploy's rows are filtered by deploy id", func(t *testing.T) {
		rows := fixture.list(t, api.ListDeploymentsParams{DeployID: api.NewOptString(deployed.DeployID)})
		assert.Len(t, rows, 3)
	})

	t.Run("expand embeds the release each row made live", func(t *testing.T) {
		rows := fixture.list(t, api.ListDeploymentsParams{Expand: []api.DeploymentExpand{api.DeploymentExpandRelease}})
		require.NotEmpty(t, rows)
		for _, row := range rows {
			require.True(t, row.Release.Set, "expand asked, release missing on %s", row.ID)
			assert.Equal(t, row.ReleaseID, row.Release.Value.ID)
			assert.NotEmpty(t, row.Release.Value.Pointers)
		}
		for _, row := range fixture.list(t, api.ListDeploymentsParams{}) {
			assert.False(t, row.Release.Set)
		}
	})

	t.Run("a release named by its digest resolves", func(t *testing.T) {
		resp, err := fixture.client.GetReleaseById(t.Context(), api.GetReleaseByIdParams{
			ProjectID: api.ProjectID(fixture.project),
			ReleaseID: api.ReleaseID(fixture.releaseID),
		})
		require.NoError(t, err)
		release := resp.(*api.Release)
		require.Len(t, release.ContentHash, 64)

		// The store changed above, so this is a new deploy of the same release.
		deployed := fixture.mustDeploy(t, &api.CreateDeploymentRequest{
			Release: "sha256:" + release.ContentHash[:16],
			Targets: []string{"https://www.acme.test"},
		})
		assert.Equal(t, fixture.releaseID, string(deployed.ReleaseID))
	})
}

// TestDeploymentRollback covers undoing a deploy: every target it moved goes
// back to what it served before, carrying that deployment's frozen values,
// and a target with no earlier release is left alone and named.
func TestDeploymentRollback(t *testing.T) {
	t.Parallel()

	fixture := newDeploymentFixture(t)
	fixture.setVariables(t, api.VariableAppliesToAll, api.UpdateVariablesRequest{
		"HOST": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("first")),
	})
	first := fixture.mustDeploy(t, &api.CreateDeploymentRequest{
		Release: fixture.releaseID,
		Targets: []string{service.TargetDefault},
	})

	fixture.setVariables(t, api.VariableAppliesToAll, api.UpdateVariablesRequest{
		"HOST": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("second")),
	})
	second := fixture.mustDeploy(t, &api.CreateDeploymentRequest{
		Release: fixture.newRelease(t),
		Targets: []string{service.TargetDefault, "https://app.acme.test"},
	})

	resp, err := fixture.client.RollbackDeployment(t.Context(), &api.RollbackRequest{}, api.RollbackDeploymentParams{
		ProjectID: api.ProjectID(fixture.project),
	})
	require.NoError(t, err)
	require.IsType(t, &api.DeployResponse{}, resp, helpers.MustMarshal(t, resp))
	rolledBack := resp.(*api.DeployResponse)

	t.Run("the default goes back to the first release with its values", func(t *testing.T) {
		require.Len(t, rolledBack.Deployments, 1)
		row := rolledBack.Deployments[0]
		assert.Equal(t, "", row.Origin)
		assert.Equal(t, first.ReleaseID, row.ReleaseID)
		assert.Equal(t, api.NewOptDeploymentReason(api.DeploymentReasonRollback), row.Metadata.Reason)
		undone, _ := row.Metadata.RollbackOf.Get()
		assert.Equal(t, second.DeployID, undone)
		assert.Equal(t, api.NewVariableScalarVariable(api.NewStringVariableScalar("first")), fixture.frozen(t, row.ID)["HOST"])
		assert.Equal(t, first.ReleaseID, fixture.live(t)[""].ReleaseID)
	})

	t.Run("a target the undone deploy created is left as it is and named", func(t *testing.T) {
		require.Len(t, rolledBack.Warnings, 1)
		assert.Contains(t, rolledBack.Warnings[0], "https://app.acme.test")
		assert.Equal(t, second.ReleaseID, fixture.live(t)["https://app.acme.test"].ReleaseID)
	})

	t.Run("re-applying an earlier deploy by id", func(t *testing.T) {
		resp, err := fixture.client.RollbackDeployment(t.Context(), &api.RollbackRequest{
			DeployID: api.NewOptNilString(second.DeployID),
		}, api.RollbackDeploymentParams{ProjectID: api.ProjectID(fixture.project)})
		require.NoError(t, err)
		require.IsType(t, &api.DeployResponse{}, resp, helpers.MustMarshal(t, resp))
		reapplied := resp.(*api.DeployResponse)
		require.Len(t, reapplied.Deployments, 1, "app.acme.test already serves that deployment")
		assert.Equal(t, second.ReleaseID, fixture.live(t)[""].ReleaseID)
	})
}

// TestDeploymentPreview covers a preview deploy: it writes a live origin row
// with the ttl, prefers the preview values, and never moves production.
func TestDeploymentPreview(t *testing.T) {
	t.Parallel()

	fixture := newDeploymentFixture(t)
	fixture.setVariables(t, api.VariableAppliesToAll, api.UpdateVariablesRequest{
		"CLIENT_ID": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("prod")),
		"CLIENT_SECRET": api.NewSecretVariableInputVariableInput(api.SecretVariableInput{
			Value: api.NewStringVariableScalar("prod-secret"), Secret: true,
		}),
	})
	fixture.setVariables(t, api.VariableAppliesToPreview, api.UpdateVariablesRequest{
		"CLIENT_ID": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("preview")),
	})

	const previewURL = "https://pr-42-acme.vercel.app"
	deployed := fixture.mustDeploy(t, &api.CreateDeploymentRequest{
		Release:    fixture.releaseID,
		Targets:    []string{previewURL, "https://PR-42-ACME.vercel.app"},
		TTLSeconds: api.NewOptInt(3600),
	})

	t.Run("one row per distinct origin, the override frozen, the secret warned about", func(t *testing.T) {
		require.Len(t, deployed.Deployments, 1, "the same origin spelled twice is one target")
		assert.Equal(t, previewURL, deployed.Deployments[0].Origin)
		frozen := fixture.frozen(t, deployed.Deployments[0].ID)
		assert.Equal(t, api.NewVariableScalarVariable(api.NewStringVariableScalar("preview")), frozen["CLIENT_ID"])
		require.Len(t, deployed.Warnings, 1)
		assert.Contains(t, deployed.Warnings[0], "CLIENT_SECRET")
	})

	t.Run("the origin row is live with the ttl and shows in the live view", func(t *testing.T) {
		resp, err := fixture.client.ListOrigins(t.Context(), api.ListOriginsParams{ProjectID: api.ProjectID(fixture.project)})
		require.NoError(t, err)
		require.IsType(t, &api.ListOriginsResponse{}, resp, helpers.MustMarshal(t, resp))
		origins := resp.(*api.ListOriginsResponse).Origins
		require.Len(t, origins, 1)
		assert.Equal(t, previewURL, origins[0].Origin)
		assert.WithinDuration(t, time.Now().Add(time.Hour), origins[0].ExpiresAt, 5*time.Minute)

		live := fixture.live(t)
		expires, ok := live[previewURL].ExpiresAt.Get()
		require.True(t, ok, "a preview row carries its expiry")
		assert.Equal(t, origins[0].ExpiresAt.Unix(), expires.Unix())
	})

	t.Run("the preview credential may deploy previews and nothing else", func(t *testing.T) {
		previewClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetPreviewDeployTokenOnApiClient(t, previewClient, fixture.projectEntity)

		resp, err := previewClient.CreateDeployment(t.Context(), &api.CreateDeploymentRequest{
			Release:    fixture.releaseID,
			Targets:    []string{"https://pr-43-acme.vercel.app"},
			TTLSeconds: api.NewOptInt(3600),
		}, api.CreateDeploymentParams{ProjectID: api.ProjectID(fixture.project)})
		require.NoError(t, err)
		require.IsType(t, &api.CreateDeploymentCreated{}, resp, helpers.MustMarshal(t, resp))

		resp, err = previewClient.CreateDeployment(t.Context(), &api.CreateDeploymentRequest{
			Release: fixture.releaseID,
			Targets: []string{service.TargetDefault},
		}, api.CreateDeploymentParams{ProjectID: api.ProjectID(fixture.project)})
		require.NoError(t, err)
		status, code, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, http.StatusForbidden, status)
		assert.Equal(t, domain.ErrDeploymentPermissionDenied().Code, code)
	})

	t.Run("retiring the origin keeps its deployment rows", func(t *testing.T) {
		resp, err := fixture.client.RemoveOrigin(t.Context(), &api.RemoveOriginReq{Origin: previewURL},
			api.RemoveOriginParams{ProjectID: api.ProjectID(fixture.project)})
		require.NoError(t, err)
		require.IsType(t, &api.RemoveOriginNoContent{}, resp, helpers.MustMarshal(t, resp))

		rows := fixture.list(t, api.ListDeploymentsParams{Origin: api.NewOptString(previewURL)})
		assert.Len(t, rows, 1)

		resp, err = fixture.client.RemoveOrigin(t.Context(), &api.RemoveOriginReq{Origin: previewURL},
			api.RemoveOriginParams{ProjectID: api.ProjectID(fixture.project)})
		require.NoError(t, err)
		status, code, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, http.StatusNotFound, status)
		assert.Equal(t, domain.ErrOriginNotFound().Code, code)
	})
}

// TestDeploymentExpectedDeploymentGuard covers the optimistic-concurrency
// check: a stale expectation answers 409 with the first target's actual
// newest deployment in the details, and changes nothing.
func TestDeploymentExpectedDeploymentGuard(t *testing.T) {
	t.Parallel()

	fixture := newDeploymentFixture(t)
	first := fixture.mustDeploy(t, &api.CreateDeploymentRequest{
		Release: fixture.releaseID,
		Targets: []string{service.TargetDefault},
	})
	secondRelease := fixture.newRelease(t)
	second := fixture.mustDeploy(t, &api.CreateDeploymentRequest{
		Release:              secondRelease,
		Targets:              []string{service.TargetDefault},
		ExpectedDeploymentID: api.NewOptNilDeploymentID(first.Deployments[0].ID),
	})

	resp := fixture.deploy(t, &api.CreateDeploymentRequest{
		Release:              fixture.releaseID,
		Targets:              []string{service.TargetDefault},
		ExpectedDeploymentID: api.NewOptNilDeploymentID(first.Deployments[0].ID),
	})
	errResp, ok := resp.(*api.CreateDeploymentErrorResponseStatusCode)
	require.True(t, ok, helpers.MustMarshal(t, resp))
	assert.Equal(t, http.StatusConflict, errResp.StatusCode)
	require.Equal(t, api.DepConflictCreateDeploymentErrorResponse, errResp.Response.Type, helpers.MustMarshal(t, resp))
	conflict := errResp.Response.DepConflict
	require.True(t, conflict.Details.Set, "conflict payload missing")
	raw, ok := conflict.Details.Value["details"]
	require.True(t, ok, "conflict payload missing from details.details")
	var details struct {
		CurrentDeploymentID string `json:"current_deployment_id"`
		CurrentReleaseID    string `json:"current_release_id"`
	}
	require.NoError(t, json.Unmarshal(raw, &details))
	assert.Equal(t, string(second.Deployments[0].ID), details.CurrentDeploymentID)
	assert.Equal(t, secondRelease, details.CurrentReleaseID)
	assert.Equal(t, secondRelease, string(fixture.live(t)[""].ReleaseID))
}

func TestDeploymentValidation(t *testing.T) {
	t.Parallel()

	fixture := newDeploymentFixture(t)

	expectError := func(t *testing.T, resp api.CreateDeploymentRes, status int, code string) {
		t.Helper()
		gotStatus, gotCode, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, status, gotStatus)
		assert.Equal(t, code, gotCode)
	}

	t.Run("an origin the allowlist does not cover", func(t *testing.T) {
		expectError(t, fixture.deploy(t, &api.CreateDeploymentRequest{
			Release: fixture.releaseID,
			Targets: []string{"https://evil.example"},
		}), http.StatusForbidden, domain.ErrProjectOriginNotAllowed(nil).Code)
	})

	t.Run("a preview target mixed with the default", func(t *testing.T) {
		expectError(t, fixture.deploy(t, &api.CreateDeploymentRequest{
			Release:    fixture.releaseID,
			Targets:    []string{service.TargetDefault, "https://pr-1-acme.vercel.app"},
			TTLSeconds: api.NewOptInt(3600),
		}), http.StatusBadRequest, domain.ErrDeploymentInvalid(nil, nil).Code)
	})

	t.Run("a preview target without a ttl", func(t *testing.T) {
		expectError(t, fixture.deploy(t, &api.CreateDeploymentRequest{
			Release: fixture.releaseID,
			Targets: []string{"https://pr-1-acme.vercel.app"},
		}), http.StatusBadRequest, domain.ErrDeploymentInvalid(nil, nil).Code)
	})

	t.Run("an unknown release", func(t *testing.T) {
		expectError(t, fixture.deploy(t, &api.CreateDeploymentRequest{
			Release: "rel_does_not_exist",
			Targets: []string{service.TargetDefault},
		}), http.StatusNotFound, domain.ErrReleaseNotFound().Code)
	})

	t.Run("a revoked release", func(t *testing.T) {
		revoked := fixture.newRelease(t)
		resp, err := fixture.client.RevokeRelease(t.Context(), api.RevokeReleaseParams{
			ProjectID: api.ProjectID(fixture.project),
			ReleaseID: api.ReleaseID(revoked),
		})
		require.NoError(t, err)
		require.IsType(t, &api.Release{}, resp, helpers.MustMarshal(t, resp))
		assert.False(t, resp.(*api.Release).RevokedAt.IsNull())

		expectError(t, fixture.deploy(t, &api.CreateDeploymentRequest{
			Release: revoked,
			Targets: []string{service.TargetDefault},
		}), http.StatusConflict, domain.ErrReleaseRevoked().Code)
	})
}

// A deployment id of one project is unreachable through another: the read is
// scoped to the project the caller named, so a foreign id answers exactly as
// an unknown one and confirms nothing.
func TestDeploymentForeignProjectReadsAsNotFound(t *testing.T) {
	t.Parallel()

	fixture := newDeploymentFixture(t)
	deployed := fixture.mustDeploy(t, &api.CreateDeploymentRequest{
		Release: fixture.releaseID,
		Targets: []string{service.TargetDefault},
	})

	other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	otherClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, otherClient, other)

	resp, err := otherClient.GetDeploymentById(t.Context(), api.GetDeploymentByIdParams{
		ProjectID:    api.ProjectID(other.ID),
		DeploymentID: deployed.Deployments[0].ID,
	})
	require.NoError(t, err)
	status, code, _, ok := errorResponseParts(t, resp)
	require.True(t, ok, helpers.MustMarshal(t, resp))
	assert.Equal(t, http.StatusNotFound, status)
	assert.Equal(t, domain.ErrDeploymentNotFound().Code, code)
}
