//go:build postgres_integration

package integration_test

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"testing"

	"github.com/descope/virtualwebauthn"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
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
	testServer := harness.EnsureTestServer(t)

	project, err := harness.EnsureProjectService(t).Create(t.Context(), nil)
	require.NoError(t, err)

	harness.CreateUserSchema(t, project.ID, harness.TestData.Schemas.CreateSchemaRequestUserSchema)

	userSchemaURL, err := url.Parse(
		"https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml",
	)
	require.NoError(t, err)

	rpOriginStr := testServer.URL
	rpOriginURL, err := url.Parse(rpOriginStr)
	require.NoError(t, err)
	rpIDStr := rpOriginURL.Hostname()

	const userID = "pkreg-flow-test-user"
	rp := virtualwebauthn.RelyingParty{ID: rpIDStr, Name: rpIDStr, Origin: rpOriginStr}

	// Existing authenticator used for the auth step (to identify the user).
	authExisting := virtualwebauthn.NewAuthenticatorWithOptions(virtualwebauthn.AuthenticatorOptions{
		UserHandle: []byte(userID),
	})
	credExisting := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	credExisting.ID = []byte("pkreg-existing-cred-01")
	credExisting.Counter = 1
	authExisting.AddCredential(credExisting)

	// New authenticator used for the registration step.
	authNew := virtualwebauthn.NewAuthenticatorWithOptions(virtualwebauthn.AuthenticatorOptions{
		UserHandle: []byte(userID),
	})
	credNew := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)

	// Seed team + user + existing passkey.
	team, err := harness.EnsureTeamService(t).CreateTeam(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
	})
	require.NoError(t, err)

	db := harness.EnsureDBPool(t)

	emailAttr, err := domain.NewCreateAttribute("email", "pkreg-flow@example.com", domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)

	userRepo := harness.EnsureUserRepo(t)
	require.NoError(t, userRepo.Create(t.Context(), db, &domain.CreateUser{
		ProjectID:           project.ID,
		SchemaURL:           userSchemaURL.String(),
		ID:                  userID,
		ParticipationTeamID: &team.ID,
		Attributes:          []*domain.CreateAttribute{emailAttr},
	}))

	passkeyRepo := harness.EnsureUserPasskeyRepo(t)
	require.NoError(t, passkeyRepo.Create(t.Context(), db, &domain.CreateUserPasskey{
		ProjectID:    project.ID,
		UserID:       userID,
		CredentialID: base64.RawURLEncoding.EncodeToString(credExisting.ID),
		PublicKey:    credExisting.Key.AttestationData(),
		AAGUID:       authExisting.Aaguid[:],
		Transports:   []string{},
		SignCount:    1,
	}))

	client := harness.EnsureAPIClient(t, project.ID)

	// Two-step flow: passkey auth → passkey_register → done.
	defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: api.ProjectID(project.ID),
		FlowDefinition: api.FlowDefinition{
			Name:       "passkey-auth-then-register",
			UserSchema: *userSchemaURL,
			Purposes:   api.FlowDefinitionPurposes{"login": "auth-step"},
			Steps: []api.FlowDefinitionStep{
				{
					Name: "auth-step",
					Actions: api.NewOptFlowDefinitionStepActions(api.FlowDefinitionStepActions{
						"passkey": api.StepAction{Primary: api.NewOptBool(true)},
					}),
					Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
						"passkey": api.FlowDefinitionStepTransitionsItem{Target: "register-step"},
					}),
				},
				{
					Name: "register-step",
					Actions: api.NewOptFlowDefinitionStepActions(api.FlowDefinitionStepActions{
						"passkey_register": api.StepAction{Primary: api.NewOptBool(true)},
					}),
					Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
						"passkey_register": api.FlowDefinitionStepTransitionsItem{Target: "done"},
					}),
				},
				{Name: "done", Complete: api.NewOptFlowDefinitionStepComplete(api.FlowDefinitionStepCompleteShow)},
			},
		},
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionDetailResponse{}, defResp, "create flow definition failed: %+v", defResp)

	// --- Start flow ---
	createResp, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{
		ProjectID: api.ProjectID(project.ID),
		Purpose:   api.CreateFlowRequestPurposeLogin,
	})
	require.NoError(t, err)
	flowHeaders, ok := createResp.(*api.FlowResponseHeaders)
	require.True(t, ok, "expected FlowResponseHeaders, got %T", createResp)
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
	authIssueOK, ok := authIssueResp.(*api.SubmitFlowStepOK)
	require.True(t, ok, "auth issue failed: %T %+v", authIssueResp, authIssueResp)
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
	authVerifyOK, ok := authVerifyResp.(*api.SubmitFlowStepOK)
	require.True(t, ok, "auth verify failed: %T %+v", authVerifyResp, authVerifyResp)
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
	regIssueOK, ok := regIssueResp.(*api.SubmitFlowStepOK)
	require.True(t, ok, "registration issue failed: %T %+v", regIssueResp, regIssueResp)
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
	regVerifyOK, ok := regVerifyResp.(*api.SubmitFlowStepOK)
	require.True(t, ok, "registration verify failed: %T %+v", regVerifyResp, regVerifyResp)

	// The flow advances to "done" which has no user factor requirement — no handoff yet.
	// (The passkey auth step resolves the user; passkey register step doesn't re-issue a handoff.)
	// Confirm by checking the step is complete.
	require.True(t, regVerifyOK.Response.Step.Complete.Set, "expected step complete after registration")

	// Confirm a new credential row exists (in addition to the seeded one).
	pks, err := passkeyRepo.List(t.Context(), db,
		database.WithCondition(passkeyRepo.ProjectIDCondition(project.ID)),
		database.WithCondition(passkeyRepo.UserIDCondition(userID)),
	)
	require.NoError(t, err)
	require.Len(t, pks, 2, "expected two passkeys (original + newly registered)")
}
