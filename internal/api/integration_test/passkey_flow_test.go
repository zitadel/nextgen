//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
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

// TestPasskeyFlowLogin exercises the full two-phase passkey ceremony through the
// flow-engine REST API: start flow → submit passkey action (issue) → submit
// challenge response (verify) → assert handoff token.
//
// Covers the discoverable (usernameless) path: no identifier step is needed;
// the WebAuthn assertion carries the user handle and the server binds the user
// from the assertion.
func TestPasskeyFlowLogin(t *testing.T) {
	t.Parallel()

	testServer := harness.EnsureTestServer(t)

	// --- Seed project ---------------------------------------------------------
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	// Create the user schema so the resolver can look it up from the DB.  The
	// schema's $id becomes the URL that the flow definition references.
	harness.CreateUserSchema(t, project, harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)

	userSchemaURL := "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/examples/user-schema-example.yaml"

	// --- Virtual authenticator ------------------------------------------------
	// The RP origin / id are derived from the test-server URL exactly as the
	// handler does: RPID = Hostname(), RPOrigins = [Origin.String()].
	rpOriginStr := testServer.URL // e.g. "http://127.0.0.1:PORT"
	rpOriginURL, err := url.Parse(rpOriginStr)
	require.NoError(t, err)
	rpIDStr := rpOriginURL.Hostname() // "127.0.0.1"

	// Suffix user and credential IDs per run so the test stays re-runnable
	// against a persistent database (ZITADEL_TEST_POSTGRES_URL): earlier runs
	// leave their rows behind, and fixed IDs would collide with them.
	suffix := time.Now().Format("150405.000000")
	userID := "pk-flow-test-user-" + suffix
	rp := virtualwebauthn.RelyingParty{ID: rpIDStr, Name: "Test", Origin: rpOriginStr}
	auth := virtualwebauthn.NewAuthenticatorWithOptions(virtualwebauthn.AuthenticatorOptions{
		UserHandle: []byte(userID),
	})
	cred := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	// Use an ASCII credential ID so string(cred.ID) is valid UTF-8 for Postgres TEXT.
	cred.ID = []byte("pk-flow-test-cred-" + suffix)
	cred.Counter = 1
	auth.AddCredential(cred)

	// --- Seed user + passkey into DB ------------------------------------------
	// user_attributes is partitioned by team; a team is required.
	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)

	users := harness.EnsureUserFixture(t)
	passkeys := harness.EnsureUserPasskeyFixture(t)

	// Decoy: another project holding the SAME user id and credential id but a
	// different key pair. Credential resolution must stay project-scoped —
	// with an unscoped lookup the decoy row (seeded first, so surfaced first)
	// would win the credential-id match and the assertion signature would
	// fail against its foreign public key.
	decoyProject, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	harness.CreateUserSchema(t, decoyProject, harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)
	decoyTeam, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: decoyProject.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)
	decoyEmailAttr, err := domain.NewCreateAttribute("email", "pk-flow-test@example.com", domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)
	require.NoError(t, users.Create(t.Context(), &domain.CreateUser{
		ProjectID:               decoyProject.ID,
		SchemaURL:               userSchemaURL,
		ID:                      userID,
		InitialMembershipTeamID: &decoyTeam.ID,
		Attributes:              domain.CreateAttributes{*decoyEmailAttr},
	}))
	decoyCred := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	require.NoError(t, passkeys.Create(t.Context(), &domain.CreateUserPasskey{
		ProjectID:    decoyProject.ID,
		UserID:       userID,
		CredentialID: base64.RawURLEncoding.EncodeToString(cred.ID),
		PublicKey:    decoyCred.Key.AttestationData(),
		AAGUID:       auth.Aaguid[:],
		Transports:   []string{},
		SignCount:    1,
	}))

	emailAttr, err := domain.NewCreateAttribute("email", "pk-flow-test@example.com", domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)

	require.NoError(t, users.Create(t.Context(), &domain.CreateUser{
		ProjectID:               project.ID,
		SchemaURL:               userSchemaURL,
		ID:                      userID,
		InitialMembershipTeamID: &team.ID,
		Attributes:              domain.CreateAttributes{*emailAttr},
	}))

	require.NoError(t, passkeys.Create(t.Context(), &domain.CreateUserPasskey{
		ProjectID:    project.ID,
		UserID:       userID,
		CredentialID: base64.RawURLEncoding.EncodeToString(cred.ID),
		PublicKey:    cred.Key.AttestationData(),
		AAGUID:       auth.Aaguid[:],
		Transports:   []string{},
		SignCount:    1,
	}))

	// --- Create passkey login flow definition ---------------------------------
	client, err := helpers.NewApiClient(testServer.URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	defResp, err := client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID: api.ProjectID(project.ID),
		FlowDefinition: api.FlowDefinition{
			Name:       "passkey-login",
			Status:     "active",
			UserSchema: userSchemaURL,
			Purposes:   api.FlowDefinitionPurposes{"login": "passkey-step"},
			Steps: []api.FlowDefinitionStep{
				{
					Name:   "passkey-step",
					Fields: []string{"email"},
					Actions: []api.StepAction{
						{Name: "passkey", Kind: api.StepActionKindPasskey, Primary: api.NewOptBool(true)},
					},
					Transitions: api.NewOptFlowDefinitionStepTransitions(api.FlowDefinitionStepTransitions{
						"passkey": api.FlowDefinitionStepTransitionsItem{Target: "done"},
					}),
				},
				{
					Name:     "done",
					Complete: api.NewOptFlowDefinitionStepComplete(api.FlowDefinitionStepCompleteShow),
				},
			},
		},
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionDetailResponse{}, defResp, "create flow definition failed: %s", helpers.MustMarshal(t, defResp))

	// --- Start flow -----------------------------------------------------------
	createResp, err := client.CreateFlow(t.Context(), &api.CreateFlowRequest{
		ProjectID: api.ProjectID(project.ID),
		Purpose:   api.CreateFlowRequestPurposeLogin,
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, createResp, helpers.MustMarshal(t, createResp))
	flowHeaders := createResp.(*api.FlowResponseHeaders)

	flowID := flowHeaders.Response.ID
	zflow := mustExtractZflow(t, flowHeaders.SetCookie.Value)

	// --- Issue phase: action=passkey ------------------------------------------
	issueResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "passkey",
	}, api.SubmitFlowStepParams{
		ID:     flowID,
		Zflow:  zflow,
		Origin: api.NewOptURI(*rpOriginURL),
	})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, issueResp, helpers.MustMarshal(t, issueResp))
	issueOK := issueResp.(*api.SubmitFlowStepOK)
	zflow = mustExtractZflow(t, issueOK.SetCookie.Value)

	require.True(t, issueOK.Response.Step.Challenge.Set, "expected step.challenge after passkey issue")
	challenge := issueOK.Response.Step.Challenge.Value
	challengeID, challengeIDSet := challenge.ChallengeID.Get()
	require.True(t, challengeIDSet, "expected challenge_id in step.challenge")
	require.True(t, challenge.Options.Set, "expected options in step.challenge")

	// --- Sign assertion with virtual authenticator ----------------------------
	optionsJSON, err := json.Marshal(challenge.Options.Value)
	require.NoError(t, err)
	assertionOpts, err := virtualwebauthn.ParseAssertionOptions(string(optionsJSON))
	require.NoError(t, err)
	assertionJSON := virtualwebauthn.CreateAssertionResponse(rp, auth, cred, *assertionOpts)

	var proof api.FlowSubmitRequestChallengeResponseProof
	require.NoError(t, json.Unmarshal([]byte(assertionJSON), &proof))

	// --- Verify phase: submit challenge response ------------------------------
	verifyResp, err := client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
		Action: "passkey",
		ChallengeResponse: api.NewOptFlowSubmitRequestChallengeResponse(
			api.FlowSubmitRequestChallengeResponse{
				ChallengeID: api.NewOptString(challengeID),
				Method:      api.NewOptString("passkey"),
				Proof:       api.NewOptFlowSubmitRequestChallengeResponseProof(proof),
			},
		),
	}, api.SubmitFlowStepParams{
		ID:    flowID,
		Zflow: zflow,
	})
	require.NoError(t, err)
	require.IsType(t, &api.SubmitFlowStepOK{}, verifyResp, helpers.MustMarshal(t, verifyResp))
	verifyOK := verifyResp.(*api.SubmitFlowStepOK)

	handoffToken, hasToken := verifyOK.Response.HandoffToken.Get()
	require.True(t, hasToken, "expected handoff token after successful passkey login")
	require.NotEmpty(t, handoffToken)
}

// mustExtractZflow parses a Set-Cookie header value and returns the _zflow
// cookie value to pass as SubmitFlowStepParams.Zflow on the next request.
func mustExtractZflow(t *testing.T, setCookieHeader string) string {
	t.Helper()
	h := http.Header{"Set-Cookie": []string{setCookieHeader}}
	for _, c := range (&http.Response{Header: h}).Cookies() {
		if c.Name == "_zflow" {
			return c.Value
		}
	}
	t.Fatalf("_zflow cookie not found in Set-Cookie header: %q", setCookieHeader)
	return ""
}
