//go:build postgres_integration || spanner_integration

package integration_test

import (
	"crypto/pbkdf2"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"github.com/go-faster/jx"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
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
	salt, err := hex.DecodeString(c.Salt)
	require.NoError(t, err)
	nonce, err := hex.DecodeString(c.Nonce)
	require.NoError(t, err)
	input := make([]byte, 20)
	copy(input, nonce)
	for trial := uint32(0); trial < 512; trial++ {
		binary.BigEndian.PutUint32(input[16:], trial)
		key, err := pbkdf2.Key(sha256.New, string(input), salt, 5000, 32)
		require.NoError(t, err)
		if hex.EncodeToString(key[:16]) == c.KeyPrefix {
			raw, err := json.Marshal(map[string]string{"protocol": c.Protocol, "challenge_id": c.ChallengeID, "derived_key": hex.EncodeToString(key)})
			require.NoError(t, err)
			return api.NewOptFlowSubmitRequestGateProofs(api.FlowSubmitRequestGateProofs{"signup_pow": string(raw)})
		}
	}
	t.Fatal("signup challenge unsolvable")
	return api.OptFlowSubmitRequestGateProofs{}
}
func currentSignupProofs(t *testing.T, client *helpers.ApiClient, id, cookie string) api.OptFlowSubmitRequestGateProofs {
	t.Helper()
	resp, err := client.GetFlowStep(t.Context(), api.GetFlowStepParams{ID: id, Zflow: cookie})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, resp, helpers.MustMarshal(t, resp))
	return signupProofs(t, resp.(*api.FlowResponseHeaders).Response.Step)
}

func TestSignupProofRequiredAndSingleUse(t *testing.T) {
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	def, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{ProjectID: api.ProjectID(project.ID), FlowDefinition: combinedPasswordFlowDefinition(defaultSchemaURL())})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, def)
	started, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{ProjectID: api.ProjectID(project.ID), Purpose: api.CreateFlowRequestPurposeRegister}, api.CreateFlowParams{})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, started)
	start := started.(*api.FlowResponseHeaders)
	step := mustSubmitOK(t, client, start.Response.ID, mustExtractZflow(t, start.SetCookie), "submit", api.FlowSubmitRequestFields{"email": jx.Raw(`"pow-signup@example.com"`)})
	cookie := mustExtractZflow(t, step.SetCookie)
	req := &api.FlowSubmitRequest{Action: "submit", Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{"x-auth-methods#password": jx.Raw(`"correct-horse-battery-staple"`)})}
	params := api.SubmitFlowStepParams{ID: start.Response.ID, Zflow: cookie}
	missing, err := client.SubmitFlowStep(t.Context(), req, params)
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepErrorResponseStatusCode{}, missing)
	require.Equal(t, 403, missing.(*api.SubmitFlowStepErrorResponseStatusCode).StatusCode)
	req.GateProofs = signupProofs(t, step.Response.Step)
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
