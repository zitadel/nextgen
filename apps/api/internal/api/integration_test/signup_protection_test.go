//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"github.com/go-faster/jx"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/crypto/pow"
	"github.com/zitadel/nextgen/internal/crypto/pow/powtest"
	api "go.zitadel.com/zitadel/v5/api"
	"testing"
)

func signupProofs(t *testing.T, step api.FlowStep) api.OptFlowSubmitRequestGateProofs {
	t.Helper()
	gate, ok := step.Gates["signup_pow"]
	if !ok {
		return api.OptFlowSubmitRequestGateProofs{}
	}
	require.Equal(t, "zitadel_pow", gate.Provider)
	c, ok := gate.Challenge.Get()
	require.True(t, ok)
	return api.NewOptFlowSubmitRequestGateProofs(api.FlowSubmitRequestGateProofs{"signup_pow": powtest.Solve(t, &pow.PublicChallenge{Protocol: c.Protocol, ChallengeID: c.ChallengeID, ProfileID: c.ProfileID, Salt: c.Salt, Nonce: c.Nonce, KeyPrefix: c.KeyPrefix, ExpiresAt: c.ExpiresAt})})
}
func currentSignupProofs(t *testing.T, client *helpers.ApiClient, id, cookie string) api.OptFlowSubmitRequestGateProofs {
	t.Helper()
	resp, err := client.GetFlowStep(t.Context(), api.GetFlowStepParams{ID: id, Zflow: cookie})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, resp, helpers.MustMarshal(t, resp))
	return signupProofs(t, resp.(*api.FlowResponseHeaders).Response.Step)
}

func TestSignupProofRequiredAndCompletedCookieRejected(t *testing.T) {
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	def, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{ProjectID: api.ProjectID(project.ID), FlowDefinition: combinedPasswordFlowDefinition(defaultSchemaURL())})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, def)
	deployPrimary(t, project.ID)
	// Start at sign-in: the submits that switch to signup must announce the gate.
	started, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{ProjectID: api.ProjectID(project.ID), Purpose: api.CreateFlowRequestPurposeLogin}, api.CreateFlowParams{})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, started)
	start := started.(*api.FlowResponseHeaders)
	email := api.FlowSubmitRequestFields{"email": jx.Raw(`"pow-signup@example.com"`)}
	switched := mustSubmitOK(t, client, start.Response.ID, mustExtractZflow(t, start.SetCookie), "register", email)
	require.Equal(t, "register-identifier", switched.Response.Step.Name)
	step := mustSubmitOK(t, client, start.Response.ID, mustExtractZflow(t, switched.SetCookie), "submit", email)
	require.Equal(t, "register-password", step.Response.Step.Name)
	gate, ok := step.Response.Step.Gates["signup_pow"]
	require.True(t, ok, helpers.MustMarshal(t, step))
	require.False(t, gate.Challenge.IsSet(), "Submit announces the gate; GET issues the puzzle")
	cookie := mustExtractZflow(t, step.SetCookie)
	req := &api.FlowSubmitRequest{Action: "submit", Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{"x-auth-methods#password": jx.Raw(`"correct-horse-battery-staple"`)})}
	params := api.SubmitFlowStepParams{ID: start.Response.ID, Zflow: cookie}
	missing, err := client.SubmitFlowStep(t.Context(), req, params)
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepErrorResponseStatusCode{}, missing)
	require.Equal(t, 403, missing.(*api.SubmitFlowStepErrorResponseStatusCode).StatusCode)
	req.GateProofs = currentSignupProofs(t, client, start.Response.ID, cookie)
	done, err := client.SubmitFlowStep(t.Context(), req, params)
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, done, helpers.MustMarshal(t, done))
	require.Equal(t, "done", done.(*api.SubmitFlowStepOK).Response.Step.Name)
	// Replaying the old cookie and proof cannot create a second user or run a KDF.
	replay, err := client.SubmitFlowStep(t.Context(), req, params)
	require.NoError(t, err)
	// The completed auth attempt rejects this even before the proof check.
	// The portable storage test covers two still-live concurrent consumers.
	require.IsType(t, &api.ErrorDetails{}, replay, helpers.MustMarshal(t, replay))
	require.Equal(t, api.ErrorCode("flow.restart_required"), replay.(*api.ErrorDetails).Code)
}
