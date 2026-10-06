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

type allowlistFixture struct {
	project *domain.Project
	client  *helpers.ApiClient
}

func newAllowlistFixture(t *testing.T) allowlistFixture {
	t.Helper()
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, false)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	return allowlistFixture{project: project, client: client}
}

func (f allowlistFixture) add(t *testing.T, pattern string, kind api.AllowedOriginKind) api.AddAllowedOriginRes {
	t.Helper()
	resp, err := f.client.AddAllowedOrigin(t.Context(), &api.AllowedOrigin{Pattern: pattern, Kind: kind},
		api.AddAllowedOriginParams{ProjectID: api.ProjectID(f.project.ID)})
	require.NoError(t, err)
	return resp
}

func (f allowlistFixture) mustAdd(t *testing.T, pattern string, kind api.AllowedOriginKind) *api.AddAllowedOriginResponse {
	t.Helper()
	resp := f.add(t, pattern, kind)
	require.IsType(t, &api.AddAllowedOriginResponse{}, resp, helpers.MustMarshal(t, resp))
	return resp.(*api.AddAllowedOriginResponse)
}

func (f allowlistFixture) setClass(t *testing.T, class api.ProjectClass, confirm bool) api.SetProjectClassRes {
	t.Helper()
	resp, err := f.client.SetProjectClass(t.Context(), &api.SetProjectClassReq{Class: class, Confirm: api.NewOptBool(confirm)},
		api.SetProjectClassParams{ProjectID: api.ProjectID(f.project.ID)})
	require.NoError(t, err)
	return resp
}

func (f allowlistFixture) current(t *testing.T) *api.ProjectResponse {
	t.Helper()
	resp, err := f.client.GetProject(t.Context(), api.GetProjectParams{ProjectID: api.ProjectID(f.project.ID)})
	require.NoError(t, err)
	require.IsType(t, &api.ProjectResponse{}, resp, helpers.MustMarshal(t, resp))
	return resp.(*api.ProjectResponse)
}

func expectErrorParts(t *testing.T, resp any, status int, code string) {
	t.Helper()
	gotStatus, gotCode, _, ok := errorResponseParts(t, resp)
	require.True(t, ok, helpers.MustMarshal(t, resp))
	assert.Equal(t, status, gotStatus)
	assert.Equal(t, code, gotCode)
}

// TestAllowedOrigins covers the allowlist: one pattern per call, linted
// against the class, and the class change that re-checks them all.
func TestAllowedOrigins(t *testing.T) {
	t.Parallel()

	fixture := newAllowlistFixture(t)

	t.Run("a primary literal passes", func(t *testing.T) {
		added := fixture.mustAdd(t, "https://App.Acme.test", api.AllowedOriginKindPrimary)
		assert.Equal(t, "https://app.acme.test", added.Pattern, "normalised")
		assert.Equal(t, api.AddAllowedOriginResponseCheckStatusOk, added.Check.Status)
	})

	t.Run("a bounded preview wildcard on a known host passes", func(t *testing.T) {
		added := fixture.mustAdd(t, "https://*-acme.vercel.app", api.AllowedOriginKindPreview)
		assert.Equal(t, api.AddAllowedOriginResponseCheckStatusOk, added.Check.Status)
	})

	t.Run("a wildcard on a host the server does not know is a warning", func(t *testing.T) {
		added := fixture.mustAdd(t, "https://*.preview.acme.test", api.AllowedOriginKindPreview)
		assert.Equal(t, api.AddAllowedOriginResponseCheckStatusWarning, added.Check.Status)
		assert.Equal(t, "origin_host_unknown", added.Check.Code.Value)
	})

	t.Run("a sandbox accepts loopback", func(t *testing.T) {
		fixture.mustAdd(t, "http://localhost:3000", api.AllowedOriginKindPrimary)
	})

	t.Run("the same pattern twice is refused", func(t *testing.T) {
		expectErrorParts(t, fixture.add(t, "https://app.acme.test", api.AllowedOriginKindPrimary),
			http.StatusBadRequest, domain.ErrOriginInvalid(nil).Code)
	})

	t.Run("promotion names every pattern production refuses", func(t *testing.T) {
		resp := fixture.setClass(t, api.ProjectClassProduction, false)
		expectErrorParts(t, resp, http.StatusBadRequest, domain.ErrProjectClassChangeRefused(nil).Code)
		assert.Equal(t, api.ProjectClassSandbox, fixture.current(t).Class)
	})

	t.Run("removing the offender lets the promotion through", func(t *testing.T) {
		resp, err := fixture.client.RemoveAllowedOrigin(t.Context(), &api.RemoveAllowedOriginReq{Pattern: "http://localhost:3000"},
			api.RemoveAllowedOriginParams{ProjectID: api.ProjectID(fixture.project.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.RemoveAllowedOriginNoContent{}, resp, helpers.MustMarshal(t, resp))

		promoted := fixture.setClass(t, api.ProjectClassProduction, false)
		require.IsType(t, &api.ProjectResponse{}, promoted, helpers.MustMarshal(t, promoted))
		assert.Equal(t, api.ProjectClassProduction, promoted.(*api.ProjectResponse).Class)
		assert.Len(t, fixture.current(t).AllowedOrigins, 3)
	})

	t.Run("production refuses loopback, a wildcard primary and an unbounded preview", func(t *testing.T) {
		expectErrorParts(t, fixture.add(t, "http://localhost:4000", api.AllowedOriginKindPrimary),
			http.StatusBadRequest, domain.ErrOriginNotPermittedForClass(nil).Code)
		expectErrorParts(t, fixture.add(t, "https://*.acme.test", api.AllowedOriginKindPrimary),
			http.StatusBadRequest, domain.ErrOriginNotPermittedForClass(nil).Code)
		expectErrorParts(t, fixture.add(t, "https://*.vercel.app", api.AllowedOriginKindPreview),
			http.StatusBadRequest, domain.ErrOriginUnbounded(nil).Code)
	})

	t.Run("demotion needs confirmation", func(t *testing.T) {
		expectErrorParts(t, fixture.setClass(t, api.ProjectClassSandbox, false),
			http.StatusBadRequest, domain.ErrProjectClassChangeRefused(nil).Code)
		demoted := fixture.setClass(t, api.ProjectClassSandbox, true)
		require.IsType(t, &api.ProjectResponse{}, demoted, helpers.MustMarshal(t, demoted))
		assert.Equal(t, api.ProjectClassSandbox, demoted.(*api.ProjectResponse).Class)
	})

	t.Run("removing a pattern the allowlist does not hold is not found", func(t *testing.T) {
		resp, err := fixture.client.RemoveAllowedOrigin(t.Context(), &api.RemoveAllowedOriginReq{Pattern: "https://nowhere.acme.test"},
			api.RemoveAllowedOriginParams{ProjectID: api.ProjectID(fixture.project.ID)})
		require.NoError(t, err)
		expectErrorParts(t, resp, http.StatusNotFound, domain.ErrOriginNotFound().Code)
	})

	t.Run("the preview credential may not widen the allowlist", func(t *testing.T) {
		previewClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetPreviewDeployTokenOnApiClient(t, previewClient, fixture.project)
		resp, err := previewClient.AddAllowedOrigin(t.Context(), &api.AllowedOrigin{Pattern: "https://evil.example", Kind: api.AllowedOriginKindPrimary},
			api.AddAllowedOriginParams{ProjectID: api.ProjectID(fixture.project.ID)})
		require.NoError(t, err)
		status, _, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, http.StatusForbidden, status)
	})
}
