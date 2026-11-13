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

	"github.com/zitadel/nextgen/api/client"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	api "go.zitadel.com/zitadel/v5/api"
)

// TestFlowOperationsAnswerAtTheirOldPath runs a flow the way a login component
// released before the collection became `/flows` does: started, rendered and
// submitted at `/flow`, under the prefix and at the root. Each answer is the
// one the new path gives, and says the old path is deprecated, which the new
// path's never does (ADR 077 §4).
func TestFlowOperationsAnswerAtTheirOldPath(t *testing.T) {
	t.Parallel()

	const appOrigin = "https://app.example.test"
	const flowsDocs = "<" + client.DocsOrigin + `/docs/reference/api/flows>; rel="deprecation"; type="text/html"`
	const baseURLDocs = "<" + client.DocsOrigin + `/docs/reference/api#base-url>; rel="deprecation"; type="text/html"`
	server := harness.EnsureTestServer(t).URL
	unauth, err := helpers.NewApiClient(server)
	require.NoError(t, err)
	created, err := unauth.CreateProject(t.Context(), &api.CreateProjectRequest{
		Name:    helpers.ProjectName(),
		Origins: []api.ProjectOrigin{{Pattern: appOrigin, Kind: api.ProjectOriginKindPrimary}},
	})
	require.NoError(t, err)
	project, ok := created.(*api.CreateProjectResponse)
	require.True(t, ok, helpers.MustMarshal(t, created))
	harness.CleanupProject(t, project.ID)
	deployPrimary(t, string(project.ID))

	start, err := json.Marshal(map[string]string{"project_id": string(project.ID), "purpose": "login"})
	require.NoError(t, err)
	submission, err := json.Marshal(map[string]any{
		"action": "submit",
		"fields": map[string]string{"email": "nobody@example.test"},
	})
	require.NoError(t, err)

	send := func(t *testing.T, method, url string, body []byte, zflow string) (*http.Response, []byte) {
		t.Helper()
		req, err := http.NewRequestWithContext(t.Context(), method, url, bytes.NewReader(body))
		require.NoError(t, err)
		req.Header.Set("Origin", appOrigin)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if zflow != "" {
			req.AddCookie(&http.Cookie{Name: "_zflow", Value: zflow})
		}
		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		answer, err := io.ReadAll(resp.Body)
		require.NoError(t, err)
		return resp, answer
	}
	// step is a flow's answer without what differs from one flow to the next:
	// its ID and its session's.
	step := func(t *testing.T, body []byte) map[string]any {
		t.Helper()
		var answer map[string]any
		require.NoError(t, json.Unmarshal(body, &answer), string(body))
		require.Contains(t, answer, "step", string(body))
		delete(answer, "id")
		delete(answer, "session_id")
		return answer
	}
	flowID := func(t *testing.T, body []byte) string {
		t.Helper()
		var opened api.FlowResponse
		require.NoError(t, opened.UnmarshalJSON(body), string(body))
		return opened.ID
	}

	current := server + client.PathPrefix + "/flows"
	wantStart, wantStartBody := send(t, http.MethodPost, current, start, "")
	require.Equal(t, http.StatusCreated, wantStart.StatusCode, string(wantStartBody))
	assert.Empty(t, wantStart.Header.Get("Deprecation"))
	assert.Empty(t, wantStart.Header.Values("Link"))

	for _, tt := range []struct {
		name, base string
		links      []string
	}{
		{name: "under the prefix", base: server + client.PathPrefix, links: []string{flowsDocs}},
		// The root alias's own Link comes first.
		{name: "at the root", base: server, links: []string{baseURLDocs, flowsDocs}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			deprecated := func(t *testing.T, resp *http.Response) {
				t.Helper()
				assert.Regexp(t, `^@[1-9][0-9]*$`, resp.Header.Get("Deprecation"))
				assert.Equal(t, tt.links, resp.Header.Values("Link"))
			}

			started, startedBody := send(t, http.MethodPost, tt.base+"/flow", start, "")
			require.Equal(t, wantStart.StatusCode, started.StatusCode, string(startedBody))
			assert.Equal(t, step(t, wantStartBody), step(t, startedBody))
			assert.Equal(t, wantStart.Header.Get("Cache-Control"), started.Header.Get("Cache-Control"))
			deprecated(t, started)
			id, zflow := flowID(t, startedBody), flowCookie(t, started)

			wantRender, wantRenderBody := send(t, http.MethodGet, current+"/"+id, nil, zflow)
			require.Equal(t, http.StatusOK, wantRender.StatusCode, string(wantRenderBody))
			assert.Empty(t, wantRender.Header.Get("Deprecation"))
			assert.Empty(t, wantRender.Header.Values("Link"))
			rendered, renderedBody := send(t, http.MethodGet, tt.base+"/flow/"+id, nil, zflow)
			require.Equal(t, wantRender.StatusCode, rendered.StatusCode, string(renderedBody))
			assert.JSONEq(t, string(wantRenderBody), string(renderedBody))
			assert.Equal(t, wantRender.Header.Get("Cache-Control"), rendered.Header.Get("Cache-Control"))
			deprecated(t, rendered)

			// A step, not an error: the submission reached the operation.
			submitted, submittedBody := send(t, http.MethodPost, tt.base+"/flow/"+id+"/submit", submission, zflow)
			var answered api.FlowResponse
			require.NoError(t, answered.UnmarshalJSON(submittedBody), string(submittedBody))
			assert.Equal(t, wantStart.Header.Get("Cache-Control"), submitted.Header.Get("Cache-Control"))
			assert.NotEmpty(t, flowCookie(t, submitted))
			deprecated(t, submitted)

			// A method the old path's operations do not take names none.
			refused, refusedBody := send(t, http.MethodGet, tt.base+"/flow", nil, "")
			assert.Equal(t, http.StatusMethodNotAllowed, refused.StatusCode, string(refusedBody))
			assert.Empty(t, refused.Header.Get("Deprecation"))
			assert.Empty(t, refused.Header.Values("Link"))
		})
	}
}
