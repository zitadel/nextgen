//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

// deploymentFixture is a release fixture plus one assembled release: the
// smallest thing a deployment can make live.
type deploymentFixture struct {
	releaseFixture
	releaseID string
}

func newDeploymentFixture(t *testing.T) deploymentFixture {
	t.Helper()
	fixture := newReleaseFixture(t)
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

func (f deploymentFixture) mustDeploy(t *testing.T, req *api.CreateDeploymentRequest) *api.Deployment {
	t.Helper()
	resp := f.deploy(t, req)
	require.IsType(t, &api.CreateDeploymentCreated{}, resp, helpers.MustMarshal(t, resp))
	deployed := api.Deployment(*resp.(*api.CreateDeploymentCreated))
	return &deployed
}

func (f deploymentFixture) environmentByName(t *testing.T, name string) *api.Environment {
	t.Helper()
	resp, err := f.client.GetEnvironmentByName(t.Context(), api.GetEnvironmentByNameParams{
		ProjectID: api.ProjectID(f.project),
		Name:      api.EnvironmentName(name),
	})
	require.NoError(t, err)
	require.IsType(t, &api.Environment{}, resp, helpers.MustMarshal(t, resp))
	return resp.(*api.Environment)
}

func (f deploymentFixture) list(t *testing.T, params api.ListDeploymentsParams) api.ListDeploymentsRes {
	t.Helper()
	params.ProjectID = api.ProjectID(f.project)
	resp, err := f.client.ListDeployments(t.Context(), params)
	require.NoError(t, err)
	return resp
}

// TestDeployments covers the deployments surface (#532): creating one
// atomically points the environment at the release, the log lists newest
// first, and the environment reads surface the current deployment.
func TestDeployments(t *testing.T) {
	t.Parallel()

	fixture := newDeploymentFixture(t)

	// No reason: the schema default (deploy) fills it, so the plain case
	// needs no annotation.
	deployed := fixture.mustDeploy(t, &api.CreateDeploymentRequest{
		Environment: "dev",
		ReleaseID:   api.ReleaseID(fixture.releaseID),
	})

	t.Run("the record carries resolved ids and the caller identity", func(t *testing.T) {
		assert.True(t, domain.PrefixDeployment.Matches(string(deployed.ID)), "id %q is not dep_-prefixed", deployed.ID)
		assert.Equal(t, fixture.project, string(deployed.ProjectID))
		assert.Equal(t, fixture.releaseID, string(deployed.ReleaseID))
		assert.Equal(t, api.NewOptDeploymentReason(api.DeploymentReasonDeploy), deployed.Metadata.Reason)
		assert.True(t, deployed.Metadata.SourceEnvironmentID.IsNull(), "a plain deploy has no source")
		// The caller is a project secret: it names no user, so deployed_by is
		// null, but deployed_by_type still says a machine deployed this.
		assert.True(t, deployed.Metadata.DeployedBy.IsNull(), "a project secret names no user")
		assert.Equal(t, api.DeploymentMetadataDeployedByTypeService, deployed.Metadata.DeployedByType.Value)

		dev := fixture.environmentByName(t, "dev")
		assert.Equal(t, dev.ID, deployed.EnvironmentID, "environment resolved from its name")
	})

	t.Run("environment reads surface the current deployment", func(t *testing.T) {
		dev := fixture.environmentByName(t, "dev")
		require.False(t, dev.CurrentDeployment.IsNull())
		current := dev.CurrentDeployment.Value
		assert.Equal(t, deployed.ID, current.ID)
		assert.Equal(t, fixture.releaseID, string(current.ReleaseID))
		assert.Equal(t, api.DeploymentReasonDeploy, current.Reason)

		// An environment nothing was deployed to reads as explicit null.
		staging := fixture.environmentByName(t, "staging")
		assert.True(t, staging.CurrentDeployment.IsNull())
	})

	t.Run("get by id", func(t *testing.T) {
		resp, err := fixture.client.GetDeploymentById(t.Context(), api.GetDeploymentByIdParams{
			ProjectID:    api.ProjectID(fixture.project),
			DeploymentID: deployed.ID,
		})
		require.NoError(t, err)
		require.IsType(t, &api.Deployment{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, deployed.ID, resp.(*api.Deployment).ID)
	})

	t.Run("promote records the source environment", func(t *testing.T) {
		promoted := fixture.mustDeploy(t, &api.CreateDeploymentRequest{
			Environment:       "staging",
			ReleaseID:         api.ReleaseID(fixture.releaseID),
			Reason:            api.NewOptDeploymentReason(api.DeploymentReasonPromote),
			SourceEnvironment: api.NewOptNilEnvironmentName("dev"),
		})
		dev := fixture.environmentByName(t, "dev")
		require.False(t, promoted.Metadata.SourceEnvironmentID.IsNull())
		source, _ := promoted.Metadata.SourceEnvironmentID.Get()
		assert.Equal(t, dev.ID, source, "source resolved from its name")
	})

	t.Run("re-deploying the running release is a no-op", func(t *testing.T) {
		resp := fixture.deploy(t, &api.CreateDeploymentRequest{
			Environment: "dev",
			ReleaseID:   api.ReleaseID(fixture.releaseID),
			Reason:      api.NewOptDeploymentReason(api.DeploymentReasonDeploy),
		})
		require.IsType(t, &api.CreateDeploymentOK{}, resp, helpers.MustMarshal(t, resp))
		reused := api.Deployment(*resp.(*api.CreateDeploymentOK))
		assert.Equal(t, deployed.ID, reused.ID, "the answer is the deployment that made it live")
		assert.Equal(t, deployed.DeployedAt, reused.DeployedAt)

		listResp := fixture.list(t, api.ListDeploymentsParams{
			EnvironmentName: api.NewOptEnvironmentName("dev"),
		})
		require.IsType(t, &api.ListDeploymentsResponse{}, listResp, helpers.MustMarshal(t, listResp))
		assert.Len(t, listResp.(*api.ListDeploymentsResponse).Deployments, 1, "nothing was written")
	})

	t.Run("a second deployment replaces the current one and the log keeps both", func(t *testing.T) {
		second := fixture.mustDeploy(t, &api.CreateDeploymentRequest{
			Environment: "dev",
			ReleaseID:   api.ReleaseID(fixture.newRelease(t)),
			Reason:      api.NewOptDeploymentReason(api.DeploymentReasonDeploy),
		})

		dev := fixture.environmentByName(t, "dev")
		require.False(t, dev.CurrentDeployment.IsNull())
		assert.Equal(t, second.ID, dev.CurrentDeployment.Value.ID)

		resp := fixture.list(t, api.ListDeploymentsParams{
			EnvironmentName: api.NewOptEnvironmentName("dev"),
		})
		require.IsType(t, &api.ListDeploymentsResponse{}, resp, helpers.MustMarshal(t, resp))
		listed := resp.(*api.ListDeploymentsResponse).Deployments
		require.Len(t, listed, 2)
		assert.Equal(t, second.ID, listed[0].ID, "the first row is the current deployment")
		assert.Equal(t, deployed.ID, listed[1].ID)
	})

	t.Run("expand embeds the release each deployment made live", func(t *testing.T) {
		resp := fixture.list(t, api.ListDeploymentsParams{
			Expand: []api.DeploymentExpand{api.DeploymentExpandRelease},
		})
		require.IsType(t, &api.ListDeploymentsResponse{}, resp, helpers.MustMarshal(t, resp))
		listed := resp.(*api.ListDeploymentsResponse).Deployments
		require.NotEmpty(t, listed)
		for _, entity := range listed {
			require.True(t, entity.Release.Set, "expand asked, release missing on %s", entity.ID)
			assert.Equal(t, entity.ReleaseID, entity.Release.Value.ID)
			assert.NotEmpty(t, entity.Release.Value.Pointers,
				"the same representation GET /releases/{release_id} serves")
		}

		// Not asking omits the property entirely — "did not ask" is
		// distinguishable from asked-for content (ADR 059).
		resp = fixture.list(t, api.ListDeploymentsParams{})
		require.IsType(t, &api.ListDeploymentsResponse{}, resp, helpers.MustMarshal(t, resp))
		for _, entity := range resp.(*api.ListDeploymentsResponse).Deployments {
			assert.False(t, entity.Release.Set)
		}
	})

	t.Run("the unfiltered list spans environments", func(t *testing.T) {
		resp := fixture.list(t, api.ListDeploymentsParams{})
		require.IsType(t, &api.ListDeploymentsResponse{}, resp, helpers.MustMarshal(t, resp))
		environments := make(map[string]bool)
		for _, entity := range resp.(*api.ListDeploymentsResponse).Deployments {
			environments[entity.EnvironmentID] = true
		}
		assert.Len(t, environments, 2, "dev and staging both deployed above")
	})

	t.Run("listing an unknown environment is not an empty history", func(t *testing.T) {
		resp := fixture.list(t, api.ListDeploymentsParams{
			EnvironmentName: api.NewOptEnvironmentName("nosuchenv"),
		})
		status, code, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, http.StatusNotFound, status)
		assert.Equal(t, domain.ErrEnvironmentNotFound().Code, code)
	})
}

// TestDeploymentExpectedCurrentGuard covers the optimistic-concurrency check:
// a stale expectation answers 409 with the actual current deployment and
// release in the details, and changes nothing.
func TestDeploymentExpectedCurrentGuard(t *testing.T) {
	t.Parallel()

	fixture := newDeploymentFixture(t)

	first := fixture.mustDeploy(t, &api.CreateDeploymentRequest{
		Environment: "dev",
		ReleaseID:   api.ReleaseID(fixture.releaseID),
		Reason:      api.NewOptDeploymentReason(api.DeploymentReasonDeploy),
	})

	// A matching expectation deploys.
	secondRelease := fixture.newRelease(t)
	second := fixture.mustDeploy(t, &api.CreateDeploymentRequest{
		Environment:                 "dev",
		ReleaseID:                   api.ReleaseID(secondRelease),
		Reason:                      api.NewOptDeploymentReason(api.DeploymentReasonDeploy),
		ExpectedCurrentDeploymentID: api.NewOptNilDeploymentID(first.ID),
	})

	// A stale one answers 409 carrying what actually runs.
	resp := fixture.deploy(t, &api.CreateDeploymentRequest{
		Environment:                 "dev",
		ReleaseID:                   api.ReleaseID(fixture.releaseID),
		Reason:                      api.NewOptDeploymentReason(api.DeploymentReasonDeploy),
		ExpectedCurrentDeploymentID: api.NewOptNilDeploymentID(first.ID),
	})
	errResp, ok := resp.(*api.CreateDeploymentErrorResponseStatusCode)
	require.True(t, ok, helpers.MustMarshal(t, resp))
	assert.Equal(t, http.StatusConflict, errResp.StatusCode)
	require.Equal(t, api.DepConflictCreateDeploymentErrorResponse, errResp.Response.Type, helpers.MustMarshal(t, resp))
	conflict := errResp.Response.DepConflict
	assert.Equal(t, domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{}).Code, conflict.Code)

	// The payload rides the legacy details.details slot (ADR 030); assert
	// the exact wire JSON so an envelope change cannot silently drop it.
	require.True(t, conflict.Details.Set, "conflict payload missing")
	raw, ok := conflict.Details.Value["details"]
	require.True(t, ok, "conflict payload missing from details.details")
	var details struct {
		CurrentDeploymentID string `json:"current_deployment_id"`
		CurrentReleaseID    string `json:"current_release_id"`
	}
	require.NoError(t, json.Unmarshal(raw, &details))
	assert.Equal(t, string(second.ID), details.CurrentDeploymentID)
	assert.Equal(t, secondRelease, details.CurrentReleaseID)

	// Nothing changed: the environment still runs the second deployment.
	dev := fixture.environmentByName(t, "dev")
	require.False(t, dev.CurrentDeployment.IsNull())
	assert.Equal(t, second.ID, dev.CurrentDeployment.Value.ID)
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

	t.Run("an unknown environment name is not found", func(t *testing.T) {
		resp := fixture.deploy(t, &api.CreateDeploymentRequest{
			Environment: "nosuchenv",
			ReleaseID:   api.ReleaseID(fixture.releaseID),
			Reason:      api.NewOptDeploymentReason(api.DeploymentReasonDeploy),
		})
		expectError(t, resp, http.StatusNotFound, domain.ErrEnvironmentNotFound().Code)
	})

	t.Run("an unknown release is invalid", func(t *testing.T) {
		resp := fixture.deploy(t, &api.CreateDeploymentRequest{
			Environment: "dev",
			ReleaseID:   "rel_does_not_exist",
			Reason:      api.NewOptDeploymentReason(api.DeploymentReasonDeploy),
		})
		expectError(t, resp, http.StatusBadRequest, domain.ErrDeploymentInvalid(nil, nil).Code)
	})

	t.Run("promote requires a source", func(t *testing.T) {
		resp := fixture.deploy(t, &api.CreateDeploymentRequest{
			Environment: "dev",
			ReleaseID:   api.ReleaseID(fixture.releaseID),
			Reason:      api.NewOptDeploymentReason(api.DeploymentReasonPromote),
		})
		expectError(t, resp, http.StatusBadRequest, domain.ErrDeploymentInvalid(nil, nil).Code)
	})

	t.Run("deploy rejects a source", func(t *testing.T) {
		resp := fixture.deploy(t, &api.CreateDeploymentRequest{
			Environment:       "dev",
			ReleaseID:         api.ReleaseID(fixture.releaseID),
			Reason:            api.NewOptDeploymentReason(api.DeploymentReasonDeploy),
			SourceEnvironment: api.NewOptNilEnvironmentName("staging"),
		})
		expectError(t, resp, http.StatusBadRequest, domain.ErrDeploymentInvalid(nil, nil).Code)
	})
}

// A deployment id of one project is unreachable through another: the read is
// scoped to the project the caller named, so a foreign id answers exactly as
// an unknown one and confirms nothing.
func TestDeploymentForeignProjectReadsAsNotFound(t *testing.T) {
	t.Parallel()

	fixture := newDeploymentFixture(t)
	deployed := fixture.mustDeploy(t, &api.CreateDeploymentRequest{
		Environment: "dev",
		ReleaseID:   api.ReleaseID(fixture.releaseID),
		Reason:      api.NewOptDeploymentReason(api.DeploymentReasonDeploy),
	})

	other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	otherClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, otherClient, other)

	resp, err := otherClient.GetDeploymentById(t.Context(), api.GetDeploymentByIdParams{
		ProjectID:    api.ProjectID(other.ID),
		DeploymentID: deployed.ID,
	})
	require.NoError(t, err)
	status, code, _, ok := errorResponseParts(t, resp)
	require.True(t, ok, helpers.MustMarshal(t, resp))
	assert.Equal(t, http.StatusNotFound, status)
	assert.Equal(t, domain.ErrDeploymentNotFound().Code, code)
}
