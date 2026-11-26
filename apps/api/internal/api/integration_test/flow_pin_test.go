//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	api "go.zitadel.com/zitadel/v5/api"
)

// TestFlowPinsRelease opens flows that pin a release with X-Zitadel-Release.
// The subtests share one project and run in order: two releases deployed one
// after the other to the primary origins, so the first is in the origin's
// history but no longer what it serves.
func TestFlowPinsRelease(t *testing.T) {
	t.Parallel()

	fixture := newDeploymentFixture(t)
	first := fixture.otherReleaseWith(t, "v1")
	second := fixture.otherReleaseWith(t, "v2")
	for _, release := range []api.ReleaseID{first, second} {
		deployed := fixture.deploy(t, release)
		require.IsType(t, &api.CreateDeploymentCreated{}, deployed, helpers.MustMarshal(t, deployed))
	}

	t.Run("without a pin the origin serves the newest deployment", func(t *testing.T) {
		resp, body := openPinnedFlow(t, fixture.project, appOrigin, "")
		require.Equal(t, http.StatusCreated, resp.StatusCode, string(body))
		assert.Contains(t, flowTemplate(t, body), "v2")
	})

	t.Run("a pin keeps its release through a newer deploy", func(t *testing.T) {
		resp, body := openPinnedFlow(t, fixture.project, appOrigin, string(first))
		require.Equal(t, http.StatusCreated, resp.StatusCode, string(body))
		assert.Contains(t, flowTemplate(t, body), "v1")
		var opened api.FlowResponse
		require.NoError(t, opened.UnmarshalJSON(body), string(body))

		// The flow cookie sealed the pinned deployment: a deploy between the
		// steps does not move the sign-in, and the step sends no pin.
		third := fixture.deploy(t, fixture.otherReleaseWith(t, "v3"))
		require.IsType(t, &api.CreateDeploymentCreated{}, third, helpers.MustMarshal(t, third))
		resp, body = submitFlow(t, opened.ID, flowCookie(t, resp), appOrigin)
		require.Less(t, resp.StatusCode, http.StatusBadRequest, string(body))
		assert.Contains(t, flowTemplate(t, body), "v1")
	})

	t.Run("refuses a pin it cannot serve", func(t *testing.T) {
		for name, tc := range map[string]struct {
			origin, release string
			status          int
			code            string
		}{
			"a value that is not a release id":    {appOrigin, "main", http.StatusBadRequest, domain.ErrReleaseReferenceInvalid(nil).Code},
			"a release the project does not hold": {appOrigin, "rel_missing", http.StatusNotFound, domain.ErrReleaseNotFound().Code},
			"a release never deployed here":       {appOrigin, string(fixture.release.ID), http.StatusConflict, domain.ErrReleaseNotDeployed(nil).Code},
			"a pin with no origin":                {"", string(first), http.StatusConflict, domain.ErrReleaseNotDeployed(nil).Code},
		} {
			resp, body := openPinnedFlow(t, fixture.project, tc.origin, tc.release)
			assert.Equal(t, tc.status, resp.StatusCode, "%s: %s", name, body)
			assert.Equal(t, tc.code, errorCode(body), "%s: %s", name, body)
		}
	})

	t.Run("a revoked release is refused", func(t *testing.T) {
		revoked, err := fixture.client.RevokeRelease(t.Context(), api.RevokeReleaseParams{ProjectID: api.ProjectID(fixture.project), ReleaseID: first})
		require.NoError(t, err)
		require.IsType(t, &api.Release{}, revoked, helpers.MustMarshal(t, revoked))

		resp, body := openPinnedFlow(t, fixture.project, appOrigin, string(first))
		assert.Equal(t, http.StatusConflict, resp.StatusCode, string(body))
		assert.Equal(t, domain.ErrReleaseRevoked().Code, errorCode(body), string(body))
	})
}

// openPinnedFlow starts a login flow from origin, pinning release unless it
// is empty. Sent raw: the generated client cannot leave Origin out.
func openPinnedFlow(t *testing.T, projectID, origin, release string) (*http.Response, []byte) {
	t.Helper()
	body, err := json.Marshal(map[string]string{"project_id": projectID, "purpose": "login"})
	require.NoError(t, err)
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, harness.APIBaseURL(t)+"/flows", bytes.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if release != "" {
		req.Header.Set("X-Zitadel-Release", release)
	}
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp, respBody
}

// flowTemplate is the branding template of a flow response, which names the
// release that served it.
func flowTemplate(t *testing.T, body []byte) string {
	t.Helper()
	var flow api.FlowResponse
	require.NoError(t, flow.UnmarshalJSON(body), string(body))
	return flow.Branding.Value.LiquidTemplate.Value
}
