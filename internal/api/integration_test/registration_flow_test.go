//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"testing"
	"time"

	"github.com/descope/virtualwebauthn"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// TestPasskeyRegistrationFlow exercises the full passkey registration ceremony
// through the flow engine using a two-step flow:
//
//  1. passkey auth step (discoverable login) → identifies the user via an
//     existing credential + user handle
//  2. passkey_register step → registers a NEW credential for the resolved user
//
// This avoids the need for an identifier field with x-unique in the schema.
func TestPasskeyRegistrationFlow(t *testing.T) {
	t.Parallel()

	testServer := harness.EnsureTestServer(t)

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	harness.CreateUserSchema(t, project, harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)

	userSchemaURL := "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml"

	rpOriginStr := testServer.URL
	rpOriginURL, err := url.Parse(rpOriginStr)
	require.NoError(t, err)
	rpIDStr := rpOriginURL.Hostname()

	// Suffix user and credential IDs per run so the test stays re-runnable
	// against a persistent database (ZITADEL_TEST_POSTGRES_URL): earlier runs
	// leave their rows behind, and fixed IDs would collide with them.
	suffix := time.Now().Format("150405.000000")
	userID := "pkreg-flow-test-user-" + suffix
	rp := virtualwebauthn.RelyingParty{ID: rpIDStr, Name: rpIDStr, Origin: rpOriginStr}

	// Existing authenticator used for the auth step (to identify the user).
	authExisting := virtualwebauthn.NewAuthenticatorWithOptions(virtualwebauthn.AuthenticatorOptions{
		UserHandle: []byte(userID),
	})
	credExisting := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	credExisting.ID = []byte("pkreg-existing-cred-" + suffix)
	credExisting.Counter = 1
	authExisting.AddCredential(credExisting)

	// New authenticator used for the registration step.
	authNew := virtualwebauthn.NewAuthenticatorWithOptions(virtualwebauthn.AuthenticatorOptions{
		UserHandle: []byte(userID),
	})
	credNew := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)

	// Seed team + user + existing passkey.
	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)

	emailAttr, err := domain.NewCreateAttribute("email", "pkreg-flow@example.com", domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)

	users := harness.EnsureUserFixture(t)
	require.NoError(t, users.Create(t.Context(), &domain.CreateUser{
		ProjectID:               project.ID,
		SchemaURL:               userSchemaURL,
		ID:                      userID,
		InitialMembershipTeamID: &team.ID,
		Attributes:              domain.CreateAttributes{*emailAttr},
	}))

	passkeys := harness.EnsureUserPasskeyFixture(t)
	require.NoError(t, passkeys.Create(t.Context(), &domain.CreateUserPasskey{
		ProjectID:    project.ID,
		UserID:       userID,
		CredentialID: base64.RawURLEncoding.EncodeToString(credExisting.ID),
		PublicKey:    credExisting.Key.AttestationData(),
		AAGUID:       authExisting.Aaguid[:],
		Transports:   []string{},
		SignCount:    1,
	}))

	client, err := helpers.NewApiClient(testServer.URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	// Two-step flow: passkey auth → passkey_register → done.
	defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: api.ProjectID(project.ID),
		FlowDefinition: api.FlowDefinition{
			Name:       "passkey-auth-then-register",
			Status:     "active",
			UserSchema: userSchemaURL,
			Purposes:   api.FlowDefinitionPurposes{"login": "auth-step"},
			Steps: []api.FlowDefinitionStep{
				{
					Name:   "auth-step",
					Fields: []string{"email"},
					Actions: []api.StepAction{
						{Name: "passkey", Kind: api.StepActionKindPasskey, Primary: api.NewOptBool(true)},
					},
					Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
						"passkey": api.FlowDefinitionStepTransitionsItem{Target: "register-step"},
					}),
				},
				{
					Name: "register-step",
					Actions: []api.StepAction{
						{Name: "passkey_register", Kind: api.StepActionKindPasskeyRegister, Primary: api.NewOptBool(true)},
					},
					Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
						"passkey_register": api.FlowDefinitionStepTransitionsItem{Target: "done"},
					}),
				},
				{Name: "done", Complete: api.NewOptFlowDefinitionStepComplete(api.FlowDefinitionStepCompleteShow)},
			},
		},
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, defResp, "create flow definition failed: %s", helpers.MustMarshal(t, defResp))

	// --- Start flow ---
	createResp, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{
		ProjectID: api.ProjectID(project.ID),
		Purpose:   api.CreateFlowRequestPurposeLogin,
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, createResp, helpers.MustMarshal(t, createResp))
	flowHeaders := createResp.(*api.FlowResponseHeaders)
	flowID := flowHeaders.Response.ID
	zflow := mustExtractZflow(t, flowHeaders.SetCookie.Value)

	// --- Auth step: issue passkey challenge ---
	authIssueResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "passkey",
	}, api.SubmitFlowStepParams{
		ID:     flowID,
		Zflow:  zflow,
		Origin: api.NewOptURI(*rpOriginURL),
	})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, authIssueResp, "auth issue failed: %s", helpers.MustMarshal(t, authIssueResp))
	authIssueOK := authIssueResp.(*api.SubmitFlowStepOK)
	zflow = mustExtractZflow(t, authIssueOK.SetCookie.Value)

	authChallenge := authIssueOK.Response.Step.Challenge.Value
	authChallengeID, _ := authChallenge.ChallengeID.Get()
	optionsJSON, err := json.Marshal(authChallenge.Options.Value)
	require.NoError(t, err)
	assertionOpts, err := virtualwebauthn.ParseAssertionOptions(string(optionsJSON))
	require.NoError(t, err)
	assertionJSON := virtualwebauthn.CreateAssertionResponse(rp, authExisting, credExisting, *assertionOpts)

	var assertionProof api.FlowSubmitRequestChallengeResponseProof
	require.NoError(t, json.Unmarshal([]byte(assertionJSON), &assertionProof))

	// --- Auth step: verify passkey (identifies the user) ---
	authVerifyResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "passkey",
		ChallengeResponse: api.NewOptFlowSubmitRequestChallengeResponse(api.FlowSubmitRequestChallengeResponse{
			ChallengeID: api.NewOptString(authChallengeID),
			Method:      api.NewOptString("passkey"),
			Proof:       api.NewOptFlowSubmitRequestChallengeResponseProof(assertionProof),
		}),
	}, api.SubmitFlowStepParams{
		ID:    flowID,
		Zflow: zflow,
	})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, authVerifyResp, "auth verify failed: %s", helpers.MustMarshal(t, authVerifyResp))
	authVerifyOK := authVerifyResp.(*api.SubmitFlowStepOK)
	require.Equal(t, "register-step", authVerifyOK.Response.Step.Name)
	zflow = mustExtractZflow(t, authVerifyOK.SetCookie.Value)

	// --- Register step: issue creation challenge ---
	regIssueResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "passkey_register",
	}, api.SubmitFlowStepParams{
		ID:     flowID,
		Zflow:  zflow,
		Origin: api.NewOptURI(*rpOriginURL),
	})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, regIssueResp, "registration issue failed: %s", helpers.MustMarshal(t, regIssueResp))
	regIssueOK := regIssueResp.(*api.SubmitFlowStepOK)
	zflow = mustExtractZflow(t, regIssueOK.SetCookie.Value)

	require.True(t, regIssueOK.Response.Step.Challenge.Set, "expected challenge on issue")
	regChallenge := regIssueOK.Response.Step.Challenge.Value
	regChallengeID, _ := regChallenge.ChallengeID.Get()
	require.True(t, regChallenge.Options.Set, "expected creation options")

	// Generate fake attestation.
	creationOptionsJSON, err := json.Marshal(regChallenge.Options.Value)
	require.NoError(t, err)
	attestOpts, err := virtualwebauthn.ParseAttestationOptions(string(creationOptionsJSON))
	require.NoError(t, err)
	attestationJSON := virtualwebauthn.CreateAttestationResponse(rp, authNew, credNew, *attestOpts)

	var attestProof api.FlowSubmitRequestChallengeResponseProof
	require.NoError(t, json.Unmarshal([]byte(attestationJSON), &attestProof))

	// --- Register step: verify attestation ---
	regVerifyResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "passkey_register",
		ChallengeResponse: api.NewOptFlowSubmitRequestChallengeResponse(api.FlowSubmitRequestChallengeResponse{
			ChallengeID: api.NewOptString(regChallengeID),
			Method:      api.NewOptString("passkey_register"),
			Proof:       api.NewOptFlowSubmitRequestChallengeResponseProof(attestProof),
		}),
	}, api.SubmitFlowStepParams{
		ID:    flowID,
		Zflow: zflow,
	})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, regVerifyResp, "registration verify failed: %s", helpers.MustMarshal(t, regVerifyResp))
	regVerifyOK := regVerifyResp.(*api.SubmitFlowStepOK)

	// The flow advances to "done" which has no user factor requirement — no handoff yet.
	// (The passkey auth step resolves the user; passkey register step doesn't re-issue a handoff.)
	// Confirm by checking the step is complete.
	require.True(t, regVerifyOK.Response.Step.Complete.Set, "expected step complete after registration")

	// Confirm a new credential row exists (in addition to the seeded one).
	pks, err := passkeys.ListByUser(t.Context(), project.ID, userID)
	require.NoError(t, err)
	require.Len(t, pks, 2, "expected two passkeys (original + newly registered)")
}
