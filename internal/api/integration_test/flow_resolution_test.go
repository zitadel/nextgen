//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// flowStart is what one raw POST /flow answered: the status, the error code
// when refused, and the first step's name when served.
type flowStart struct {
	status int
	code   string
	step   string
}

// startFlow posts /flow the way a browser or a server would: with whatever
// Origin and X-Zitadel-Release headers the caller sets and nothing else.
// The generated client cannot set the Origin header, which is the whole
// point of these cases.
func startFlow(t *testing.T, projectID, origin, release string) flowStart {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
		harness.EnsureTestServer(t).URL+"/flow",
		strings.NewReader(`{"project_id":"`+projectID+`","purpose":"login"}`))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if release != "" {
		req.Header.Set("X-Zitadel-Release", release)
	}
	resp, err := harness.EnsureHttpClient(t).Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)

	var parsed struct {
		Code string `json:"code"`
		Step struct {
			Name string `json:"name"`
		} `json:"step"`
	}
	require.NoError(t, json.Unmarshal(body, &parsed), string(body))
	return flowStart{status: resp.StatusCode, code: parsed.Code, step: parsed.Step.Name}
}

// pinnedLoginDefinition is a login definition whose first step is named
// after the release it belongs to, so a test can read off which release
// served the attempt.
func pinnedLoginDefinition(userSchemaURL, firstStep string) api.FlowDefinition {
	def := passwordLoginFlowDefinition(userSchemaURL)
	def.Name = "login-" + firstStep
	def.Purposes = api.FlowDefinitionPurposes{"login": firstStep}
	def.Steps[0].Name = firstStep
	return def
}

// TestFlowResolution covers which release a sign-in is served: the origin
// gate, the route by exact origin, the project default for a caller with no
// origin, and a pin that may only select among what was deployed.
func TestFlowResolution(t *testing.T) {
	t.Parallel()

	fixture := newDeploymentFixture(t)
	projectID := fixture.project

	// Two releases that differ in the flow definition they pin, so the step
	// name says which one answered.
	releaseWith := func(t *testing.T, firstStep string) string {
		t.Helper()
		defResp, err := fixture.client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
			ProjectID:      api.ProjectID(projectID),
			FlowDefinition: pinnedLoginDefinition(fixture.schemaURL, firstStep),
		})
		require.NoError(t, err)
		require.IsType(t, &api.FlowDefinitionResponse{}, defResp, helpers.MustMarshal(t, defResp))
		pointers := []api.CreateReleasePointer{
			{Kind: api.ReleasePointerKindSchema, RevisionID: fixture.schemaURL},
			{Kind: api.ReleasePointerKindFlowDefinition, RevisionID: defResp.(*api.FlowDefinitionResponse).ID},
			{Kind: api.ReleasePointerKindBranding, RevisionID: fixture.brandingID},
		}
		resp := fixture.create(t, &api.CreateReleaseRequest{Pointers: pointers})
		require.IsType(t, &api.CreateReleaseCreated{}, resp, helpers.MustMarshal(t, resp))
		return string(resp.(*api.CreateReleaseCreated).ID)
	}
	production := releaseWith(t, "production-identifier")
	branch := releaseWith(t, "branch-identifier")
	undeployed := releaseWith(t, "undeployed-identifier")

	fixture.mustDeploy(t, &api.CreateDeploymentRequest{
		Release: production,
		Targets: []string{service.TargetDefault, service.TargetPrimary},
	})
	const previewURL = "https://pr-7-acme.vercel.app"
	fixture.mustDeploy(t, &api.CreateDeploymentRequest{
		Release:    branch,
		Targets:    []string{previewURL},
		TTLSeconds: api.NewOptInt(3600),
	})

	t.Run("a primary origin is served the release deployed to it", func(t *testing.T) {
		got := startFlow(t, projectID, "https://app.acme.test", "")
		assert.Equal(t, http.StatusCreated, got.status)
		assert.Equal(t, "production-identifier", got.step)
	})

	t.Run("a live preview origin is served its own release", func(t *testing.T) {
		got := startFlow(t, projectID, previewURL, "")
		assert.Equal(t, http.StatusCreated, got.status)
		assert.Equal(t, "branch-identifier", got.step)
	})

	t.Run("no origin is served the project default", func(t *testing.T) {
		got := startFlow(t, projectID, "", "")
		assert.Equal(t, http.StatusCreated, got.status)
		assert.Equal(t, "production-identifier", got.step)
	})

	t.Run("a preview origin without a live row is refused", func(t *testing.T) {
		got := startFlow(t, projectID, "https://evil-acme.vercel.app", "")
		assert.Equal(t, http.StatusForbidden, got.status)
		assert.Equal(t, domain.ErrProjectPreviewNotLive(nil).Code, got.code)
	})

	t.Run("an origin outside the allowlist is refused", func(t *testing.T) {
		got := startFlow(t, projectID, "https://evil.example", "")
		assert.Equal(t, http.StatusForbidden, got.status)
		assert.Equal(t, domain.ErrProjectOriginNotAllowed(nil).Code, got.code)
	})

	t.Run("a sandbox serves any pinned release", func(t *testing.T) {
		got := startFlow(t, projectID, "https://app.acme.test", undeployed)
		assert.Equal(t, http.StatusCreated, got.status)
		assert.Equal(t, "undeployed-identifier", got.step)
	})

	t.Run("production only serves a pin deployed to the matched target", func(t *testing.T) {
		promoted, err := fixture.client.SetProjectClass(t.Context(), &api.SetProjectClassReq{Class: api.ProjectClassProduction},
			api.SetProjectClassParams{ProjectID: api.ProjectID(projectID)})
		require.NoError(t, err)
		require.IsType(t, &api.ProjectResponse{}, promoted, helpers.MustMarshal(t, promoted))

		got := startFlow(t, projectID, "https://app.acme.test", undeployed)
		assert.Equal(t, http.StatusConflict, got.status)
		assert.Equal(t, domain.ErrReleaseNotDeployed(nil).Code, got.code)

		got = startFlow(t, projectID, "https://app.acme.test", branch)
		assert.Equal(t, http.StatusConflict, got.status, "deployed, but to a preview URL, not this target")

		got = startFlow(t, projectID, "https://app.acme.test", production)
		assert.Equal(t, http.StatusCreated, got.status)
		assert.Equal(t, "production-identifier", got.step)
	})

	t.Run("a revoked release is refused wherever it is served", func(t *testing.T) {
		resp, err := fixture.client.RevokeRelease(t.Context(), api.RevokeReleaseParams{
			ProjectID: api.ProjectID(projectID),
			ReleaseID: api.ReleaseID(branch),
		})
		require.NoError(t, err)
		require.IsType(t, &api.Release{}, resp, helpers.MustMarshal(t, resp))

		got := startFlow(t, projectID, previewURL, "")
		assert.Equal(t, http.StatusConflict, got.status)
		assert.Equal(t, domain.ErrReleaseRevoked().Code, got.code)
	})
}

// A project that deployed nothing yet still signs users in on a sandbox:
// the attempt reads the newest revisions, as every seeded project does.
func TestFlowResolutionSandboxFallback(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	got := startFlow(t, project.ID, "http://localhost:3000", "")
	assert.Equal(t, http.StatusCreated, got.status)
	assert.NotEmpty(t, got.step)
}
