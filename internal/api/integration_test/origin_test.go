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

type originFixture struct {
	project *domain.Project
	client  *helpers.ApiClient
}

func newOriginFixture(t *testing.T) originFixture {
	t.Helper()
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, false)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	return originFixture{project: project, client: client}
}

func (f originFixture) add(t *testing.T, pattern string, kind api.OriginKind) api.AddOriginRes {
	t.Helper()
	resp, err := f.client.AddOrigin(t.Context(), &api.Origin{Pattern: pattern, Kind: kind},
		api.AddOriginParams{ProjectID: api.ProjectID(f.project.ID)})
	require.NoError(t, err)
	return resp
}

func (f originFixture) mustAdd(t *testing.T, pattern string, kind api.OriginKind) *api.AddOriginResponse {
	t.Helper()
	resp := f.add(t, pattern, kind)
	require.IsType(t, &api.AddOriginResponse{}, resp, helpers.MustMarshal(t, resp))
	return resp.(*api.AddOriginResponse)
}

func (f originFixture) setMode(t *testing.T, mode api.ProjectMode, confirm bool) api.SetProjectModeRes {
	t.Helper()
	resp, err := f.client.SetProjectMode(t.Context(), &api.SetProjectModeReq{Mode: mode, Confirm: api.NewOptBool(confirm)},
		api.SetProjectModeParams{ProjectID: api.ProjectID(f.project.ID)})
	require.NoError(t, err)
	return resp
}

func (f originFixture) current(t *testing.T) *api.ProjectResponse {
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

// TestOrigins covers the origins: one pattern per call, linted
// against the mode, and the mode change that re-checks them all.
func TestOrigins(t *testing.T) {
	t.Parallel()

	fixture := newOriginFixture(t)

	t.Run("a primary literal passes", func(t *testing.T) {
		added := fixture.mustAdd(t, "https://App.Acme.test", api.OriginKindPrimary)
		assert.Equal(t, "https://app.acme.test", added.Pattern, "normalised")
		assert.Equal(t, api.AddOriginResponseCheckStatusOk, added.Check.Status)
	})

	t.Run("a bounded preview wildcard on a known host passes", func(t *testing.T) {
		added := fixture.mustAdd(t, "https://*-acme.vercel.app", api.OriginKindPreview)
		assert.Equal(t, api.AddOriginResponseCheckStatusOk, added.Check.Status)
	})

	t.Run("a wildcard on a host the server does not know is a warning", func(t *testing.T) {
		added := fixture.mustAdd(t, "https://*.preview.acme.test", api.OriginKindPreview)
		assert.Equal(t, api.AddOriginResponseCheckStatusWarning, added.Check.Status)
		assert.Equal(t, "origin_host_unknown", added.Check.Code.Value)
	})

	t.Run("a sandbox accepts loopback", func(t *testing.T) {
		fixture.mustAdd(t, "http://localhost:3000", api.OriginKindPrimary)
	})

	t.Run("the same pattern twice is refused", func(t *testing.T) {
		expectErrorParts(t, fixture.add(t, "https://app.acme.test", api.OriginKindPrimary),
			http.StatusBadRequest, domain.ErrOriginInvalid(nil).Code)
	})

	t.Run("promotion names every pattern production refuses", func(t *testing.T) {
		resp := fixture.setMode(t, api.ProjectModeProduction, false)
		expectErrorParts(t, resp, http.StatusBadRequest, domain.ErrProjectModeChangeRefused(nil).Code)
		assert.Equal(t, api.ProjectModeSandbox, fixture.current(t).Mode)
	})

	t.Run("removing the offender lets the promotion through", func(t *testing.T) {
		resp, err := fixture.client.RemoveOrigin(t.Context(), &api.RemoveOriginReq{Pattern: "http://localhost:3000"},
			api.RemoveOriginParams{ProjectID: api.ProjectID(fixture.project.ID)})
		require.NoError(t, err)
		require.IsType(t, &api.RemoveOriginNoContent{}, resp, helpers.MustMarshal(t, resp))

		promoted := fixture.setMode(t, api.ProjectModeProduction, false)
		require.IsType(t, &api.ProjectResponse{}, promoted, helpers.MustMarshal(t, promoted))
		assert.Equal(t, api.ProjectModeProduction, promoted.(*api.ProjectResponse).Mode)
		assert.Len(t, fixture.current(t).Origins, 3)
	})

	t.Run("production refuses loopback, a wildcard primary and an unbounded preview", func(t *testing.T) {
		expectErrorParts(t, fixture.add(t, "http://localhost:4000", api.OriginKindPrimary),
			http.StatusBadRequest, domain.ErrOriginNotPermittedForMode(nil).Code)
		expectErrorParts(t, fixture.add(t, "https://*.acme.test", api.OriginKindPrimary),
			http.StatusBadRequest, domain.ErrOriginNotPermittedForMode(nil).Code)
		expectErrorParts(t, fixture.add(t, "https://*.vercel.app", api.OriginKindPreview),
			http.StatusBadRequest, domain.ErrOriginUnbounded(nil).Code)
	})

	t.Run("demotion needs confirmation", func(t *testing.T) {
		expectErrorParts(t, fixture.setMode(t, api.ProjectModeSandbox, false),
			http.StatusBadRequest, domain.ErrProjectModeChangeRefused(nil).Code)
		demoted := fixture.setMode(t, api.ProjectModeSandbox, true)
		require.IsType(t, &api.ProjectResponse{}, demoted, helpers.MustMarshal(t, demoted))
		assert.Equal(t, api.ProjectModeSandbox, demoted.(*api.ProjectResponse).Mode)
	})

	t.Run("removing a pattern the project does not hold is not found", func(t *testing.T) {
		resp, err := fixture.client.RemoveOrigin(t.Context(), &api.RemoveOriginReq{Pattern: "https://nowhere.acme.test"},
			api.RemoveOriginParams{ProjectID: api.ProjectID(fixture.project.ID)})
		require.NoError(t, err)
		expectErrorParts(t, resp, http.StatusNotFound, domain.ErrOriginNotFound().Code)
	})

	t.Run("the preview credential may not add an origin", func(t *testing.T) {
		previewClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetPreviewDeployTokenOnApiClient(t, previewClient, fixture.project)
		resp, err := previewClient.AddOrigin(t.Context(), &api.Origin{Pattern: "https://evil.example", Kind: api.OriginKindPrimary},
			api.AddOriginParams{ProjectID: api.ProjectID(fixture.project.ID)})
		require.NoError(t, err)
		status, _, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, http.StatusForbidden, status)
	})
}
