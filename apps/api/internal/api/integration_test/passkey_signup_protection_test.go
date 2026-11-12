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
	"github.com/zitadel/nextgen/internal/domain"
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

	// The email is taken now: a second sign-up is refused before a ceremony
	// reaches the browser, so no passkey is saved for a user never created.
	restarted, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{ProjectID: api.ProjectID(project.ID), Purpose: api.CreateFlowRequestPurposeRegister}, api.CreateFlowParams{})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, restarted, helpers.MustMarshal(t, restarted))
	restart := restarted.(*api.FlowResponseHeaders)
	taken, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "passkey_register",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{"email": jx.Raw(`"passkey-signup@example.com"`)}),
	}, api.SubmitFlowStepParams{ID: restart.Response.ID, Zflow: mustExtractZflow(t, restart.SetCookie), Origin: api.NewOptURI(*origin)})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepBadRequest{}, taken, helpers.MustMarshal(t, taken))
	refused := taken.(*api.SubmitFlowStepBadRequest).Response.Step
	require.Equal(t, "register", refused.Name)
	require.Equal(t, domain.FlowStepErrorUserAlreadyExists, refused.Error.Value)
	require.False(t, refused.Challenge.Set, "a taken email issues no ceremony")
}

// A person who asks for the passkey and then cancels the browser's prompt
// continues with a password. The step still carries the ceremony, so it still
// announces the gate and a client solves it for that submit: the server takes
// it, drops the ceremony, and the unspent proof pays for the password sign-up.
func TestPasskeySignupFallsBackToAPasswordWithTheSignupProof(t *testing.T) {
	testServer := harness.EnsureTestServer(t)
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(testServer.URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	definition := passkeySignupFlowDefinition(defaultSchemaURL())
	register := &definition.Steps[0]
	register.Actions = append(register.Actions, api.StepAction{Name: "submit", Kind: api.StepActionKindSubmit})
	register.Transitions.Value["submit"] = api.FlowDefinitionStepTransitionsItem{Target: api.NewOptString("register-password")}
	definition.Steps = append(definition.Steps, api.FlowDefinitionStep{
		Name:      "register-password",
		Fields:    []string{"x-auth-methods#password"},
		OnSuccess: api.NewOptFlowDefinitionStepOnSuccess(api.FlowDefinitionStepOnSuccessCreateUser),
		Actions:   []api.StepAction{{Name: "submit", Kind: api.StepActionKindSubmit, Primary: api.NewOptBool(true)}},
		Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
			"submit": api.FlowDefinitionStepTransitionsItem{Target: api.NewOptString("done")},
		}),
	})
	def, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{ProjectID: api.ProjectID(project.ID), FlowDefinition: definition})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, def, helpers.MustMarshal(t, def))
	deployPrimary(t, project.ID)

	origin, err := url.Parse(testServer.URL)
	require.NoError(t, err)
	started, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{ProjectID: api.ProjectID(project.ID), Purpose: api.CreateFlowRequestPurposeRegister}, api.CreateFlowParams{})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, started, helpers.MustMarshal(t, started))
	start := started.(*api.FlowResponseHeaders)
	flowID := start.Response.ID
	email := api.FlowSubmitRequestFields{"email": jx.Raw(`"passkey-fallback@example.com"`)}

	issued, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{Action: "passkey_register", Fields: api.NewOptFlowSubmitRequestFields(email)},
		api.SubmitFlowStepParams{ID: flowID, Zflow: mustExtractZflow(t, start.SetCookie), Origin: api.NewOptURI(*origin)})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, issued, helpers.MustMarshal(t, issued))
	ceremony := issued.(*api.SubmitFlowStepOK)
	cookie := mustExtractZflow(t, ceremony.SetCookie)
	require.Contains(t, ceremony.Response.Step.Gates, "signup_pow")

	proofs := currentSignupProofs(t, client, flowID, cookie)
	require.True(t, proofs.IsSet(), "the ceremony step serves the puzzle")
	fallback, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{Action: "submit", Fields: api.NewOptFlowSubmitRequestFields(email), GateProofs: proofs},
		api.SubmitFlowStepParams{ID: flowID, Zflow: cookie})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, fallback, helpers.MustMarshal(t, fallback))
	password := fallback.(*api.SubmitFlowStepOK)
	require.Equal(t, "register-password", password.Response.Step.Name)
	require.False(t, password.Response.Step.Challenge.Set, "the abandoned ceremony is dropped")

	// Nothing spent the proof, so the flow's puzzle is still the one solved.
	done, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action:     "submit",
		Fields:     api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{"x-auth-methods#password": jx.Raw(`"correct-horse-battery-staple"`)}),
		GateProofs: proofs,
	}, api.SubmitFlowStepParams{ID: flowID, Zflow: mustExtractZflow(t, password.SetCookie)})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, done, helpers.MustMarshal(t, done))
	require.True(t, done.(*api.SubmitFlowStepOK).Response.Step.Complete.Set, helpers.MustMarshal(t, done))
}
