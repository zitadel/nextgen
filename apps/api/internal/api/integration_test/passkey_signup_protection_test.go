//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"encoding/json"
	"net/url"
	"testing"

	"github.com/descope/virtualwebauthn"
	"github.com/go-faster/jx"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/storage/database"
	api "go.zitadel.com/zitadel/v5/api"
)

// passkeySignupFlowDefinition is the passkey-first preset's sign-up: an
// email, then a passkey registration that creates the user.
func passkeySignupFlowDefinition(userSchema string) api.FlowDefinition {
	return api.FlowDefinition{
		Name:       "passkey-signup",
		Status:     "active",
		UserSchema: userSchema,
		Purposes:   api.FlowDefinitionPurposes{"register": "register"},
		Steps: []api.FlowDefinitionStep{
			{
				Name:   "register",
				Fields: []string{"email"},
				Actions: []api.StepAction{
					{Name: "passkey_register", Kind: api.StepActionKindPasskeyRegister, Primary: api.NewOptBool(true)},
				},
				Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
					"passkey_register": api.FlowDefinitionStepTransitionsItem{Target: api.NewOptString("done")},
				}),
			},
			{Name: "done", Complete: api.NewOptFlowDefinitionStepComplete(api.FlowDefinitionStepCompleteShow)},
		},
	}
}

// A passkey registration that creates its user is a sign-up: its ceremony
// step announces the gate, and the attestation is refused without a proof
// and accepted with one, against the same ceremony.
func TestPasskeySignupRequiresTheSignupProof(t *testing.T) {
	testServer := harness.EnsureTestServer(t)
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(testServer.URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	def, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{ProjectID: api.ProjectID(project.ID), FlowDefinition: passkeySignupFlowDefinition(defaultSchemaURL())})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, def, helpers.MustMarshal(t, def))
	deployPrimary(t, project.ID)

	origin, err := url.Parse(testServer.URL)
	require.NoError(t, err)
	rp := virtualwebauthn.RelyingParty{ID: origin.Hostname(), Name: origin.Hostname(), Origin: testServer.URL}

	started, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{ProjectID: api.ProjectID(project.ID), Purpose: api.CreateFlowRequestPurposeRegister}, api.CreateFlowParams{})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, started, helpers.MustMarshal(t, started))
	start := started.(*api.FlowResponseHeaders)
	flowID := start.Response.ID
	require.Equal(t, "register", start.Response.Step.Name)
	require.NotContains(t, start.Response.Step.Gates, "signup_pow", "asking for the ceremony creates nobody")

	issued, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "passkey_register",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{"email": jx.Raw(`"passkey-signup@example.com"`)}),
	}, api.SubmitFlowStepParams{ID: flowID, Zflow: mustExtractZflow(t, start.SetCookie), Origin: api.NewOptURI(*origin)})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, issued, helpers.MustMarshal(t, issued))
	ceremony := issued.(*api.SubmitFlowStepOK)
	cookie := mustExtractZflow(t, ceremony.SetCookie)
	gate, ok := ceremony.Response.Step.Gates["signup_pow"]
	require.True(t, ok, "the step whose attestation creates the user announces the gate: %s", helpers.MustMarshal(t, ceremony))
	require.False(t, gate.Challenge.IsSet(), "Submit announces the gate; GET issues the puzzle")

	challenge := ceremony.Response.Step.Challenge.Value
	challengeID, _ := challenge.ChallengeID.Get()
	options, err := json.Marshal(challenge.Options.Value)
	require.NoError(t, err)
	attestOpts, err := virtualwebauthn.ParseAttestationOptions(string(options))
	require.NoError(t, err)
	authenticator := virtualwebauthn.NewAuthenticatorWithOptions(virtualwebauthn.AuthenticatorOptions{UserHandle: []byte(attestOpts.UserID)})
	credential := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	var attestation api.FlowSubmitRequestChallengeResponseProof
	require.NoError(t, json.Unmarshal([]byte(virtualwebauthn.CreateAttestationResponse(rp, authenticator, credential, *attestOpts)), &attestation))
	req := &api.FlowSubmitRequest{
		Action: "passkey_register",
		ChallengeResponse: api.NewOptFlowSubmitRequestChallengeResponse(api.FlowSubmitRequestChallengeResponse{
			ChallengeID: api.NewOptString(challengeID),
			Method:      api.NewOptString("passkey_register"),
			Proof:       api.NewOptFlowSubmitRequestChallengeResponseProof(attestation),
		}),
	}
	params := api.SubmitFlowStepParams{ID: flowID, Zflow: cookie}

	missing, err := client.SubmitFlowStep(t.Context(), req, params)
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepErrorResponseStatusCode{}, missing, helpers.MustMarshal(t, missing))
	require.Equal(t, 403, missing.(*api.SubmitFlowStepErrorResponseStatusCode).StatusCode)
	users := harness.EnsureUserFixture(t)
	_, err = users.GetByID(t.Context(), project.ID, attestOpts.UserID)
	require.ErrorAs(t, err, new(*database.NoRowFoundError), "a refused proof creates no user")

	// The refusal left the ceremony intact: the same attestation goes
	// through once it carries a proof of the puzzle the ceremony step serves.
	req.GateProofs = currentSignupProofs(t, client, flowID, cookie)
	require.True(t, req.GateProofs.IsSet(), "a GET of the ceremony step prepares the puzzle")
	done, err := client.SubmitFlowStep(t.Context(), req, params)
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, done, helpers.MustMarshal(t, done))
	require.True(t, done.(*api.SubmitFlowStepOK).Response.Step.Complete.Set, helpers.MustMarshal(t, done))
	user, err := users.GetByID(t.Context(), project.ID, attestOpts.UserID)
	require.NoError(t, err)
	require.Equal(t, attestOpts.UserID, user.ID)
}
