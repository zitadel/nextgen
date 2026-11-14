//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/ogen-go/ogen/validate"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	api "go.zitadel.com/zitadel/v5/api"
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

	t.Run("a pattern that is not scheme://host[:port] fails the spec's pattern", func(t *testing.T) {
		for _, pattern := range []string{"", "http://", "ftp://example.com", "https://Example.com", "https://example.com/path", "https://a*b*c.example.com", "https://example.com:99999"} {
			_, err := client.AddOrigin(t.Context(), &api.ProjectOrigin{
				Pattern: pattern,
				Kind:    api.ProjectOriginKindPreview,
			}, api.AddOriginParams{ProjectID: api.ProjectID(project.ID)})
			require.ErrorAs(t, err, new(*validate.Error), pattern)

			_, err = client.RemoveOrigin(t.Context(), &api.RemoveOriginReq{Pattern: pattern}, api.RemoveOriginParams{ProjectID: api.ProjectID(project.ID)})
			require.ErrorAs(t, err, new(*validate.Error), pattern)
		}
	})

	t.Run("add is idempotent and rejects kind conflict", func(t *testing.T) {
		first, err := client.AddProjectOrigin(t.Context(), &api.ProjectOrigin{
			Pattern: "https://preview.example.com",
			Kind:    api.ProjectOriginKindPreview,
		}, api.AddProjectOriginParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		origin, ok := first.(*api.AddOriginResponse)
		require.True(t, ok, helpers.MustMarshal(t, first))
		assert.Equal(t, "https://preview.example.com", origin.Pattern)
		assert.Equal(t, api.AddOriginResponseKindPreview, origin.Kind)

		again, err := client.AddProjectOrigin(t.Context(), &api.ProjectOrigin{
			Pattern: "https://preview.example.com",
			Kind:    api.ProjectOriginKindPreview,
		}, api.AddProjectOriginParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		_, ok = again.(*api.AddOriginResponse)
		require.True(t, ok, helpers.MustMarshal(t, again))

		conflict, err := client.AddProjectOrigin(t.Context(), &api.ProjectOrigin{
			Pattern: "https://preview.example.com",
			Kind:    api.ProjectOriginKindPrimary,
		}, api.AddProjectOriginParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		status, code, _, ok := errorResponseParts(t, conflict)
		require.True(t, ok, helpers.MustMarshal(t, conflict))
		assert.Equal(t, http.StatusConflict, status)
		assert.Equal(t, domain.ErrOriginKindConflict().Code, code)
	})

	t.Run("remove is idempotent", func(t *testing.T) {
		_, err := client.AddProjectOrigin(t.Context(), &api.ProjectOrigin{
			Pattern: "https://tmp.example.com",
			Kind:    api.ProjectOriginKindPrimary,
		}, api.AddProjectOriginParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)

		removed, err := client.RemoveProjectOrigin(t.Context(), &api.RemoveProjectOriginReq{
			Pattern: "https://tmp.example.com",
		}, api.RemoveProjectOriginParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		_, ok := removed.(*api.RemoveProjectOriginNoContent)
		require.True(t, ok, helpers.MustMarshal(t, removed))

		again, err := client.RemoveProjectOrigin(t.Context(), &api.RemoveProjectOriginReq{
			Pattern: "https://tmp.example.com",
		}, api.RemoveProjectOriginParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		_, ok = again.(*api.RemoveProjectOriginNoContent)
		require.True(t, ok, helpers.MustMarshal(t, again))
	})

	t.Run("accepts shared-host preview wildcard as written", func(t *testing.T) {
		resp, err := client.AddProjectOrigin(t.Context(), &api.ProjectOrigin{
			Pattern: "https://*.vercel.app",
			Kind:    api.ProjectOriginKindPreview,
		}, api.AddProjectOriginParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		added, ok := resp.(*api.AddOriginResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, "https://*.vercel.app", added.Pattern)
		assert.Equal(t, api.AddOriginResponseKindPreview, added.Kind)
	})

	t.Run("rejects primary wildcard", func(t *testing.T) {
		resp, err := client.AddProjectOrigin(t.Context(), &api.ProjectOrigin{
			Pattern: "https://*.example.com",
			Kind:    api.ProjectOriginKindPrimary,
		}, api.AddProjectOriginParams{ProjectID: api.ProjectID(project.ID)})
		require.NoError(t, err)
		status, code, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, http.StatusBadRequest, status)
		assert.Equal(t, domain.ErrOriginPrimaryNotExact().Code, code)
	})

	// addProjectOrigin accepts the session cookie (#2320), so like every other
	// session write it needs the CSRF token (ADR 053 §5). The generated client
	// sends the token; a raw request carrying only the cookie must be refused
	// at the security layer, before any handler runs.
	t.Run("add refuses a session cookie without the CSRF token", func(t *testing.T) {
		console := harness.EnsurePlatformProject(t)
		claimerID, _ := harness.CreateUserOwnedByTeam(t, console.ID)
		cookie := platformSessionCookie(t, claimerID).Value
		base := harness.APIBaseURL(t)

		body := []byte(`{"pattern":"https://session.example.com","kind":"primary"}`)
		req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
			base+"/projects/"+project.ID+"/origins", bytes.NewReader(body))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: "__Host-zitadel_session", Value: cookie})

		resp, err := harness.EnsureHttpClient(t).Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		assert.Equal(t, http.StatusForbidden, resp.StatusCode,
			"a cookie-only POST /origins without the CSRF token must be refused")
		var parsed struct {
			Code string `json:"code"`
		}
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&parsed))
		assert.Equal(t, domain.ErrAuthCSRFInvalid().Code, parsed.Code)
	})
}
