//go:build postgres_integration || spanner_integration

package integration_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

// TestFlowOrigins covers which browser origins may open a flow of a project
// that lists its origins, and which may submit its steps. The server's own
// origin, from which its console previews the project's login, opens a flow
// but submits nothing to it, and neither does an opaque origin (`null`).
func TestFlowOrigins(t *testing.T) {
	t.Parallel()

	const appOrigin = "https://app.example.test"
	unauth, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	created, err := unauth.CreateProject(t.Context(), &api.CreateProjectRequest{
		Name:    helpers.ProjectName(),
		Origins: []api.ProjectOrigin{{Pattern: appOrigin, Kind: api.ProjectOriginKindPrimary}},
	})
	require.NoError(t, err)
	project, ok := created.(*api.CreateProjectResponse)
	require.True(t, ok, helpers.MustMarshal(t, created))
	harness.CleanupProject(t, project.ID)

	t.Run("an origin the project does not list cannot open a flow", func(t *testing.T) {
		resp, body := openFlow(t, project.ID, "https://evil.example.test")
		assert.Equal(t, http.StatusForbidden, resp.StatusCode, string(body))
		assert.Equal(t, domain.ErrProjectOriginNotAllowed(nil).Code, errorCode(body), string(body))
	})

	t.Run("the server's own origin opens a flow but cannot submit to it", func(t *testing.T) {
		resp, body := openFlow(t, project.ID, helpers.ConsoleOrigin)
		require.Equal(t, http.StatusCreated, resp.StatusCode, string(body))
		var opened api.FlowResponse
		require.NoError(t, opened.UnmarshalJSON(body), string(body))
		zflow := flowCookie(t, resp)

		for _, origin := range []string{helpers.ConsoleOrigin, "null"} {
			resp, body := submitFlow(t, opened.ID, zflow, origin)
			assert.Equal(t, http.StatusBadRequest, resp.StatusCode, "Origin %s: %s", origin, body)
			assert.Equal(t, domain.ErrRequestInvalid().Code, errorCode(body), "Origin %s: %s", origin, body)
		}

		// The same submission from the project's own origin reaches the step,
		// which answers with a step rather than an error: what refused the two
		// above was their origin.
		_, body = submitFlow(t, opened.ID, zflow, appOrigin)
		var answered api.FlowResponse
		require.NoError(t, answered.UnmarshalJSON(body), string(body))
	})
}

// openFlow starts a login flow the way a browser on origin does. Sent raw:
// the generated client cannot set an opaque Origin.
func openFlow(t *testing.T, projectID, origin string) (*http.Response, []byte) {
	t.Helper()
	body, err := json.Marshal(map[string]string{"project_id": projectID, "purpose": "login"})
	require.NoError(t, err)
	return postFlow(t, "/flow", body, origin, nil)
}

// submitFlow submits an email to the flow's first step from origin.
func submitFlow(t *testing.T, flowID, zflow, origin string) (*http.Response, []byte) {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"action": "submit",
		"fields": map[string]string{"email": "nobody@example.test"},
	})
	require.NoError(t, err)
	return postFlow(t, "/flow/"+flowID+"/submit", body, origin, &http.Cookie{Name: "_zflow", Value: zflow})
}

func postFlow(t *testing.T, path string, body []byte, origin string, cookie *http.Cookie) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, harness.EnsureTestServer(t).URL+path, bytes.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", origin)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp, respBody
}

func flowCookie(t *testing.T, resp *http.Response) string {
	t.Helper()
	for _, cookie := range resp.Cookies() {
		if cookie.Name == "_zflow" {
			return cookie.Value
		}
	}
	require.Fail(t, "no _zflow cookie", resp.Header.Values("Set-Cookie"))
	return ""
}

// errorCode is the code of an error response, "" when body is not one.
func errorCode(body []byte) string {
	var details api.ErrorDetails
	if err := details.UnmarshalJSON(body); err != nil {
		return ""
	}
	return string(details.Code)
}
