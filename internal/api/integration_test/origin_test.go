//go:build postgres_integration || spanner_integration

package integration_test

import (
	"bytes"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestOriginsAddRemove(t *testing.T) {
	t.Parallel()

	h := harness.EnsureTestServer(t)
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, false)
	require.NoError(t, err)

	client, err := helpers.NewApiClient(h.URL)
	require.NoError(t, err)
	// Management ops still require the project.write credential ceiling
	// (ADR 037 / #420); OpenAPI's origin.* scopes are not a substitute yet.
	harness.SetProjectSecretOnApiClient(t, client, project)

	t.Run("create round-trips origins", func(t *testing.T) {
		unauth, err := helpers.NewApiClient(h.URL)
		require.NoError(t, err)
		created, err := unauth.CreateProject(t.Context(), &api.CreateProjectRequest{
			Name: helpers.ProjectName(),
			Origins: []api.ProjectOrigin{
				{Pattern: "https://app.example.com", Kind: api.ProjectOriginKindPrimary},
				{Pattern: "https://*-acme.vercel.app", Kind: api.ProjectOriginKindPreview},
			},
			SeedDefaults: api.NewOptBool(false),
		})
		require.NoError(t, err)
		resp, ok := created.(*api.CreateProjectResponse)
		require.True(t, ok, helpers.MustMarshal(t, created))
		assert.ElementsMatch(t, []api.ProjectOrigin{
			{Pattern: "https://app.example.com", Kind: api.ProjectOriginKindPrimary},
			{Pattern: "https://*-acme.vercel.app", Kind: api.ProjectOriginKindPreview},
		}, resp.Origins)
		harness.CleanupProject(t, resp.ID)
	})

	t.Run("add is idempotent and rejects kind conflict", func(t *testing.T) {
		first, err := client.AddOrigin(t.Context(), &api.ProjectOrigin{
			Pattern: "https://preview.example.com",
			Kind:    api.ProjectOriginKindPreview,
		}, api.AddOriginParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		origin, ok := first.(*api.AddOriginResponse)
		require.True(t, ok, helpers.MustMarshal(t, first))
		assert.Equal(t, "https://preview.example.com", origin.Pattern)
		assert.Equal(t, api.AddOriginResponseKindPreview, origin.Kind)

		again, err := client.AddOrigin(t.Context(), &api.ProjectOrigin{
			Pattern: "https://preview.example.com",
			Kind:    api.ProjectOriginKindPreview,
		}, api.AddOriginParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		_, ok = again.(*api.AddOriginResponse)
		require.True(t, ok, helpers.MustMarshal(t, again))

		conflict, err := client.AddOrigin(t.Context(), &api.ProjectOrigin{
			Pattern: "https://preview.example.com",
			Kind:    api.ProjectOriginKindPrimary,
		}, api.AddOriginParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		status, code, _, ok := errorResponseParts(t, conflict)
		require.True(t, ok, helpers.MustMarshal(t, conflict))
		assert.Equal(t, http.StatusConflict, status)
		assert.Equal(t, domain.ErrOriginKindConflict().Code, code)
	})

	t.Run("remove is idempotent", func(t *testing.T) {
		_, err := client.AddOrigin(t.Context(), &api.ProjectOrigin{
			Pattern: "https://tmp.example.com",
			Kind:    api.ProjectOriginKindPrimary,
		}, api.AddOriginParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)

		removed, err := client.RemoveOrigin(t.Context(), &api.RemoveOriginReq{
			Pattern: "https://tmp.example.com",
		}, api.RemoveOriginParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		_, ok := removed.(*api.RemoveOriginNoContent)
		require.True(t, ok, helpers.MustMarshal(t, removed))

		again, err := client.RemoveOrigin(t.Context(), &api.RemoveOriginReq{
			Pattern: "https://tmp.example.com",
		}, api.RemoveOriginParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		_, ok = again.(*api.RemoveOriginNoContent)
		require.True(t, ok, helpers.MustMarshal(t, again))
	})

	t.Run("accepts shared-host preview wildcard as written", func(t *testing.T) {
		resp, err := client.AddOrigin(t.Context(), &api.ProjectOrigin{
			Pattern: "https://*.vercel.app",
			Kind:    api.ProjectOriginKindPreview,
		}, api.AddOriginParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		added, ok := resp.(*api.AddOriginCreated)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, "https://*.vercel.app", added.Pattern)
		assert.Equal(t, api.ProjectOriginKindPreview, added.Kind)
	})

	t.Run("rejects primary wildcard", func(t *testing.T) {
		resp, err := client.AddOrigin(t.Context(), &api.ProjectOrigin{
			Pattern: "https://*.example.com",
			Kind:    api.ProjectOriginKindPrimary,
		}, api.AddOriginParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		status, code, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, domain.ErrOriginPrimaryNotExact().Code, code)
	})

	// addOrigin / removeOrigin declare oauth2 only (no nextgenSession). The
	// generated client cannot offer the cookie; a raw cookie-only request must
	// still be refused at the security layer before any handler runs.
	t.Run("add refuses a raw session cookie", func(t *testing.T) {
		console := harness.EnsurePlatformProject(t)
		claimerID, _ := harness.CreateUserOwnedByTeam(t, console.ID)
		cookie := platformSessionCookie(t, claimerID).Value
		base := harness.EnsureTestServer(t).URL

		body := []byte(`{"pattern":"https://session.example.com","kind":"primary"}`)
		req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
			base+"/projects/"+project.ID+"/origins", bytes.NewReader(body))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: "__nextgen_session", Value: cookie})

		resp, err := harness.EnsureHttpClient(t).Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode,
			"a cookie-only POST /origins must be refused")
	})
}
