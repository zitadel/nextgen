//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	api "go.zitadel.com/zitadel/v5/api"
)

// TestFlowSubmitRefusesAMalformedSubmission covers the submissions refused
// before or by the engine with a 400 error envelope rather than the step: an
// sso submission without a return target or with one on another origin, and
// an action the step does not offer.
func TestFlowSubmitRefusesAMalformedSubmission(t *testing.T) {
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
	deployPrimary(t, string(project.ID))

	for _, tc := range []struct {
		name       string
		submission map[string]any
		code       string
	}{
		{"an sso submission without a return target", map[string]any{
			"action": "sso", "sso_provider_id": "google",
		}, domain.ErrRequestInvalid().Code},
		{"an sso submission returning to another origin", map[string]any{
			"action": "sso", "sso_provider_id": "google", "return_target": "https://evil.example.test/login",
		}, domain.ErrRequestInvalid().Code},
		{"an action the step does not offer", map[string]any{
			"action": "no-such-action",
		}, domain.ErrFlowInvalidAction().Code},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp, body := openFlow(t, project.ID, appOrigin)
			require.Equal(t, http.StatusCreated, resp.StatusCode, string(body))
			var opened api.FlowResponse
			require.NoError(t, opened.UnmarshalJSON(body), string(body))

			submission, err := json.Marshal(tc.submission)
			require.NoError(t, err)
			resp, body = postFlow(t, "/flows/"+opened.ID+"/submit", submission, appOrigin, &http.Cookie{Name: "_zflow", Value: flowCookie(t, resp)})
			assert.Equal(t, http.StatusBadRequest, resp.StatusCode, string(body))
			assert.Equal(t, tc.code, errorCode(body), string(body))
			assert.Empty(t, resp.Header.Values("Set-Cookie"), "a refusal leaves the flow cookie as it was")
		})
	}
}

// badRequestStep is the step a 400 echoes with its error set; it fails the
// test when resp is a refusal (the error envelope) instead.
func badRequestStep(t *testing.T, resp api.SubmitFlowStepRes) api.FlowResponse {
	t.Helper()
	bad, ok := resp.(*api.SubmitFlowStepBadRequestHeaders)
	require.True(t, ok, "not a 400: %s", helpers.MustMarshal(t, resp))
	step, ok := bad.Response.GetFlowResponse()
	require.True(t, ok, "a refusal, not the step: %s", helpers.MustMarshal(t, resp))
	return step
}
