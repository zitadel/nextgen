//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"net/url"
	"testing"

	"github.com/descope/virtualwebauthn"
	"github.com/go-faster/jx"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

// TestPostCreateUserPasskeyUpsell exercises the example 06 distinguishing
// seam: register-with-password → create_user fires → same session enrolls
// a passkey via passkey_register on the freshly-created user.
//
// The existing registration_flow_test enrolls a passkey on a *pre-seeded*
// user; the seam this test covers is whether the session/_user_id pinned
// by create_user is correctly threaded into the next step's
// passkey_register challenge, which can only break at runtime.
func TestPostCreateUserPasskeyUpsell(t *testing.T) {
	testServer := harness.EnsureTestServer(t)

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)

	rpOriginURL, err := url.Parse(testServer.URL)
	require.NoError(t, err)
	rpIDStr := rpOriginURL.Hostname()

	rp := virtualwebauthn.RelyingParty{ID: rpIDStr, Name: rpIDStr, Origin: testServer.URL}
	// UserHandle is ignored for passkey_register: the engine derives it from
	// the session's pinned _user_id, not the authenticator.
	auth := virtualwebauthn.NewAuthenticator()
	cred := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)

	client, err := helpers.NewApiClient(testServer.URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      api.ProjectID(project.ID),
		FlowDefinition: passkeyUpsellFlowDefinition(schemaURL),
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionDetailResponse{}, defResp, "create flow definition: %s", helpers.MustMarshal(t, defResp))

	createResp, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{
		ProjectID: api.ProjectID(project.ID),
		Purpose:   api.CreateFlowRequestPurposeRegister,
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, createResp, helpers.MustMarshal(t, createResp))
	flowHeaders := createResp.(*api.FlowResponseHeaders)
	flowID := flowHeaders.Response.ID
	require.Equal(t, "register", flowHeaders.Response.Step.Name)
	zflow := mustExtractZflow(t, flowHeaders.SetCookie.Value)

	const (
		newEmail = "passkey-upsell@example.com"
		newPass  = "very-good-password-1"
	)

	// register → register-password
	regResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"email": jx.Raw(`"` + newEmail + `"`),
		}),
	}, api.SubmitFlowStepParams{
		ID:    flowID,
		Zflow: zflow,
	})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, regResp, helpers.MustMarshal(t, regResp))
	regOK := regResp.(*api.SubmitFlowStepOK)
	require.Equal(t, "register-password", regOK.Response.Step.Name)
	zflow = mustExtractZflow(t, regOK.SetCookie.Value)

	// register-password → passkey-upsell (create_user fires here)
	pwResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"x-auth-methods#password": jx.Raw(`"` + newPass + `"`),
		}),
	}, api.SubmitFlowStepParams{
		ID:    flowID,
		Zflow: zflow,
	})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, pwResp, helpers.MustMarshal(t, pwResp))
	pwOK := pwResp.(*api.SubmitFlowStepOK)
	require.Equal(t, "passkey-upsell", pwOK.Response.Step.Name,
		"after create_user the session must be threaded into the passkey-upsell step")
	zflow = mustExtractZflow(t, pwOK.SetCookie.Value)

	// User is now in the DB (create_user fired).
	users := harness.EnsureUserFixture(t)
	user, err := users.GetByAttributes(t.Context(), project.ID, []domain.Attribute{{Key: "email", Value: newEmail}})
	require.NoError(t, err, "create_user must persist exactly one user before the upsell")

	// passkey-upsell: issue passkey_register challenge for the just-created user.
	issueResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "passkey_register",
	}, api.SubmitFlowStepParams{
		ID:     flowID,
		Zflow:  zflow,
		Origin: api.NewOptURI(*rpOriginURL),
	})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, issueResp, helpers.MustMarshal(t, issueResp))
	issueOK := issueResp.(*api.SubmitFlowStepOK)
	zflow = mustExtractZflow(t, issueOK.SetCookie.Value)

	require.True(t, issueOK.Response.Step.Challenge.Set, "expected challenge on passkey_register issue")
	challenge := issueOK.Response.Step.Challenge.Value
	method, methodSet := challenge.Method.Get()
	require.True(t, methodSet)
	require.Equal(t, api.FlowStepChallengeMethodPasskeyRegister, method)
	challengeID, challengeIDSet := challenge.ChallengeID.Get()
	require.True(t, challengeIDSet)
	require.True(t, challenge.Options.Set, "expected creation options on passkey_register issue")

	creationOptionsJSON, err := json.Marshal(challenge.Options.Value)
	require.NoError(t, err)
	var creationOptions struct {
		User struct {
			Name        string `json:"name"`
			DisplayName string `json:"displayName"`
		} `json:"user"`
	}
	require.NoError(t, json.Unmarshal(creationOptionsJSON, &creationOptions))
	require.Equal(t, newEmail, creationOptions.User.Name)
	require.Equal(t, newEmail, creationOptions.User.DisplayName)
	attestOpts, err := virtualwebauthn.ParseAttestationOptions(string(creationOptionsJSON))
	require.NoError(t, err)
	attestationJSON := virtualwebauthn.CreateAttestationResponse(rp, auth, cred, *attestOpts)

	var attestProof api.FlowSubmitRequestChallengeResponseProof
	require.NoError(t, json.Unmarshal([]byte(attestationJSON), &attestProof))

	// Verify passkey_register → done.
	verifyResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "passkey_register",
		ChallengeResponse: api.NewOptFlowSubmitRequestChallengeResponse(api.FlowSubmitRequestChallengeResponse{
			ChallengeID: api.NewOptString(challengeID),
			Method:      api.NewOptString("passkey_register"),
			Proof:       api.NewOptFlowSubmitRequestChallengeResponseProof(attestProof),
		}),
	}, api.SubmitFlowStepParams{
		ID:    flowID,
		Zflow: zflow,
	})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, verifyResp, helpers.MustMarshal(t, verifyResp))
	verifyOK := verifyResp.(*api.SubmitFlowStepOK)
	require.Equal(t, "done", verifyOK.Response.Step.Name)
	require.True(t, verifyOK.Response.Step.Complete.Set, "expected terminal step")

	// Passkey row exists for the freshly-created user — the seam works.
	passkeys := harness.EnsureUserPasskeyFixture(t)
	pks, err := passkeys.ListByUser(t.Context(), project.ID, user.ID)
	require.NoError(t, err, "passkey_register must enroll exactly one credential against the create_user-pinned ID")
	require.Len(t, pks, 1)
}

// TestPostCreateUserPasskeyUpsell_SkipsToDone confirms the skip branch of
// the upsell still terminates cleanly: after create_user, action=skip
// transitions to `done` without enrolling a passkey.
func TestPostCreateUserPasskeyUpsell_SkipsToDone(t *testing.T) {
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)

	server := harness.EnsureTestServer(t)
	client, err := helpers.NewApiClient(server.URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      api.ProjectID(project.ID),
		FlowDefinition: passkeyUpsellFlowDefinition(schemaURL),
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionDetailResponse{}, defResp)

	createResp, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{
		ProjectID: api.ProjectID(project.ID),
		Purpose:   api.CreateFlowRequestPurposeRegister,
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, createResp, helpers.MustMarshal(t, createResp))
	flowHeaders := createResp.(*api.FlowResponseHeaders)
	flowID := flowHeaders.Response.ID
	zflow := mustExtractZflow(t, flowHeaders.SetCookie.Value)

	const (
		newEmail = "passkey-skip@example.com"
		newPass  = "very-good-password-2"
	)

	regResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"email": jx.Raw(`"` + newEmail + `"`),
		}),
	}, api.SubmitFlowStepParams{ID: flowID, Zflow: zflow})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, regResp, helpers.MustMarshal(t, regResp))
	regOK := regResp.(*api.SubmitFlowStepOK)
	zflow = mustExtractZflow(t, regOK.SetCookie.Value)

	pwResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "submit",
		Fields: api.NewOptFlowSubmitRequestFields(api.FlowSubmitRequestFields{
			"x-auth-methods#password": jx.Raw(`"` + newPass + `"`),
		}),
	}, api.SubmitFlowStepParams{ID: flowID, Zflow: zflow})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, pwResp, helpers.MustMarshal(t, pwResp))
	pwOK := pwResp.(*api.SubmitFlowStepOK)
	require.Equal(t, "passkey-upsell", pwOK.Response.Step.Name)
	zflow = mustExtractZflow(t, pwOK.SetCookie.Value)

	skipResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "skip",
	}, api.SubmitFlowStepParams{ID: flowID, Zflow: zflow})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, skipResp, helpers.MustMarshal(t, skipResp))
	skipOK := skipResp.(*api.SubmitFlowStepOK)
	require.Equal(t, "done", skipOK.Response.Step.Name)
	require.True(t, skipOK.Response.Step.Complete.Set, "expected terminal step")
}

// passkeyUpsellFlowDefinition mirrors examples/06-combined-password-passkey's
// register sub-flow trimmed to the register → register-password → passkey-upsell
// → done path, using fields available on the default-human-user schema.
func passkeyUpsellFlowDefinition(userSchemaURL string) api.FlowDefinition {
	createUser := api.FlowDefinitionStepOnSuccessCreateUser
	return api.FlowDefinition{
		Name:       "register-with-passkey-upsell",
		Status:     "active",
		UserSchema: userSchemaURL,
		Purposes:   api.FlowDefinitionPurposes{"register": "register"},
		Steps: []api.FlowDefinitionStep{
			{
				Name:   "register",
				Fields: []string{"email"},
				Actions: []api.StepAction{
					{Name: "submit", Kind: api.StepActionKindSubmit, Primary: api.NewOptBool(true)},
				},
				Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
					"submit": api.FlowDefinitionStepTransitionsItem{Target: "register-password"},
				}),
			},
			{
				Name:      "register-password",
				Fields:    []string{"x-auth-methods#password"},
				OnSuccess: api.NewOptFlowDefinitionStepOnSuccess(createUser),
				Actions: []api.StepAction{
					{Name: "submit", Kind: api.StepActionKindSubmit, Primary: api.NewOptBool(true)},
				},
				Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
					"submit": api.FlowDefinitionStepTransitionsItem{Target: "passkey-upsell"},
				}),
			},
			{
				Name: "passkey-upsell",
				Actions: []api.StepAction{
					{Name: "passkey_register", Kind: api.StepActionKindPasskeyRegister, Primary: api.NewOptBool(true)},
					{Name: "skip", Kind: api.StepActionKindSubmit},
				},
				Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
					"passkey_register": api.FlowDefinitionStepTransitionsItem{Target: "done"},
					"skip":             api.FlowDefinitionStepTransitionsItem{Target: "done"},
				}),
			},
			{
				Name:     "done",
				Complete: api.NewOptFlowDefinitionStepComplete(api.FlowDefinitionStepCompleteShow),
			},
		},
	}
}
