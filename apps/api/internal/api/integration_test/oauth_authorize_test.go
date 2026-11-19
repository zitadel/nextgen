//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// TestOAuthAuthorize sends an authorization request to the issuer of a
// project whose deployed release enables OAuth. The refusals are
// internal/oauth's to assert: this test covers what needs the stored
// settings, client and request.
func TestOAuthAuthorize(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), []domain.Origin{
		{Pattern: oauthAppOrigin, Kind: domain.OriginKindPrimary},
	}, true)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	web := applicationFixture{project: project, client: client}.create(t, shopApplication(webClient("web", ""))).ClientSecrets[0]
	deployment := deployBundle(t, project.ID, service.BuildReleaseInput{
		ProjectID: project.ID,
		OAuth:     &service.CreateOAuthSettingsInput{ProjectID: project.ID, Enabled: true},
	})

	authorize := func(t *testing.T, clientID string) *http.Response {
		t.Helper()
		query := url.Values{
			"client_id":     {clientID},
			"redirect_uri":  {"https://web.example.com/callback"},
			"response_type": {"code"},
			"state":         {"xyz"},
		}
		req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, harness.EnsureTestServer(t).URL+"/oauth/"+project.ID+"/authorize?"+query.Encode(), nil)
		require.NoError(t, err)
		for k, v := range forwarded(t, oauthAppOrigin, "") {
			req.Header.Set(k, v)
		}
		//egress:allow integration-test harness talking to the server under test
		resp, err := (&http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(req)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())
		return resp
	}

	t.Run("a registered client reaches the login page", func(t *testing.T) {
		resp := authorize(t, web.ClientID)

		require.Equal(t, http.StatusFound, resp.StatusCode)
		location, err := resp.Location()
		require.NoError(t, err)
		handle := location.Query().Get("auth_request")
		assert.Equal(t, oauthAppOrigin+"/login?auth_request="+handle, location.String())
		require.Len(t, resp.Cookies(), 1)
		assert.True(t, strings.HasSuffix(resp.Cookies()[0].Name, handle), resp.Cookies()[0].Name)

		// The request is served from the deployment the settings were read from.
		stored, err := harness.EnsureServiceDB(t).Statements().GetAuthRequest(t.Context(), project.ID, handle)
		require.NoError(t, err)
		assert.Equal(t, deployment.ID, stored.DeploymentID)
		assert.Equal(t, deployment.ReleaseID, stored.ReleaseID)
		assert.Equal(t, web.ClientID, stored.ClientID)
		assert.Equal(t, oauthAppOrigin+"/oauth/"+project.ID, stored.Issuer)
	})

	t.Run("an unknown client is refused", func(t *testing.T) {
		assert.Equal(t, http.StatusBadRequest, authorize(t, "nobody").StatusCode)
	})
}
