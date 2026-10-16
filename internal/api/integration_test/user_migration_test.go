//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"testing"

	"github.com/descope/virtualwebauthn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
)

// migrationObjectType is the objectType both revisions of the migration
// schema share.
const migrationObjectType = "migration-identity-user"

// TestPatchUserMigrationKeepsIdentity pins the other half of #1507: a patch
// that moves a user to another revision of its schema rewrites the attributes
// and nothing else. The id, created_at, the credentials, the team membership
// and the identity link all hang off the user id, which PATCH never touches,
// so the user signs in exactly as before.
//
// It builds on the SSO resolution fixture, so like those tests it runs
// sequentially for the Spanner emulator.
func TestPatchUserMigrationKeepsIdentity(t *testing.T) {
	f := newSSOResolutionFixture(t, helpers.OIDCConnection("google"))

	// The second revision requires a property the first does not have, so the
	// migration has to change attributes to pass.
	revision := func(t *testing.T, required []string, properties string) string {
		t.Helper()
		return harness.CreateUserSchema(t, f.project, fmt.Sprintf(`{
			"title": "MigrationIdentityUser",
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			"metaSchema": "%s/user-schema.json",
			"kind": "user-schema",
			"objectType": %q,
			"type": "object",
			"x-identifier": "email",
			"x-auth-methods": {"password": {"enabled": true}, "passkey": {"enabled": true}},
			"required": %s,
			"properties": {
				"email": {"type": "string", "x-unique": "project"},
				"nickname": {"type": "string"},
				%s
			}
		}`, helpers.BuiltinSchemaBaseURL, migrationObjectType, helpers.MustMarshal(t, required), properties))
	}
	initialSchema := revision(t, []string{"email"}, `"color": {"type": "string"}`)

	// One definition offers every method. It names the schema by objectType,
	// so flows run against its newest revision.
	definition := ssoLoginFlowDefinition(migrationObjectType)
	definition.Name = "migration-login"
	definition.Steps[0].Actions = append(definition.Steps[0].Actions,
		api.StepAction{Name: "passkey", Kind: api.StepActionKindPasskey})
	definition.Steps[0].Transitions.Value["passkey"] = api.FlowDefinitionStepTransitionsItem{Target: "done"}
	defResp, err := f.client.CreateFlowDefinition(t.Context(), &api.CreateFlowDefinitionRequest{
		ProjectID:      f.projectID(),
		FlowDefinition: definition,
	})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, defResp, helpers.MustMarshal(t, defResp))
	f.definitionName = definition.Name

	// --- The user, with every kind of identity ---------------------------------
	const password = "correct-horse-battery-staple"
	userID := "user_" + helpers.RandString(8)
	email := helpers.RandString(8) + "@example.com"
	createAttemptUser(t, f.project, f.team, initialSchema, userID, map[string]string{
		"email":    email,
		"nickname": "Ada",
		"color":    "green",
	})
	setAttemptPassword(t, f.project, userID, password)

	rpOrigin, err := url.Parse(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	rp := virtualwebauthn.RelyingParty{ID: rpOrigin.Hostname(), Name: "Test", Origin: rpOrigin.String()}
	authenticator := virtualwebauthn.NewAuthenticatorWithOptions(virtualwebauthn.AuthenticatorOptions{
		UserHandle: []byte(userID),
	})
	credential := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	// An ASCII credential id, so it is valid UTF-8 for a TEXT column.
	credential.ID = []byte("migration-cred-" + helpers.RandString(8))
	credential.Counter = 1
	authenticator.AddCredential(credential)
	require.NoError(t, harness.EnsureUserPasskeyFixture(t).Create(t.Context(), &domain.CreateUserPasskey{
		ProjectID:    f.project.ID,
		UserID:       userID,
		CredentialID: base64.RawURLEncoding.EncodeToString(credential.ID),
		PublicKey:    credential.Key.AttestationData(),
		AAGUID:       authenticator.Aaguid[:],
		Transports:   []string{},
		SignCount:    1,
	}))

	f.link(t, f.connection.ID, "sub-migrant", userID)

	stmts := harness.EnsureServiceDB(t).Statements()
	before, err := harness.EnsureUserFixture(t).GetByID(t.Context(), f.project.ID, userID)
	require.NoError(t, err)
	membershipBefore, err := stmts.GetTeamMembership(t.Context(), f.project.ID, f.team.ID, userID)
	require.NoError(t, err)
	linkBefore, err := f.linkFor(t, "sub-migrant")
	require.NoError(t, err)

	// --- The migration --------------------------------------------------------
	targetSchema := revision(t, []string{"email", "givenName"}, `
		"color": {"type": "string"},
		"givenName": {"type": "string"}`)
	req := &api.PatchUserRequest{}
	require.NoError(t, req.UnmarshalJSON([]byte(helpers.MustMarshal(t, map[string]any{
		"schema": targetSchema,
		"attributes": map[string]any{
			"givenName": "Ada",
			"nickname":  "Countess",
			"color":     nil,
		},
	}))))
	resp, err := f.client.PatchUserByID(t.Context(), req, api.PatchUserByIDParams{UserID: api.UserID(userID)})
	require.NoError(t, err)
	require.IsType(t, &api.User{}, resp, helpers.MustMarshal(t, resp))
	assert.Equal(t, userID, string(resp.(*api.User).ID), "the response carries the same id")

	// --- The user moved and changed -------------------------------------------
	after, err := harness.EnsureUserFixture(t).GetByID(t.Context(), f.project.ID, userID)
	require.NoError(t, err, "the user is still found under its id")
	require.Equal(t, targetSchema, after.SchemaURL, "the migration must have happened for the rest to mean anything")
	attributes, err := after.Attributes.ToMap()
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"email": email, "nickname": "Countess", "givenName": "Ada"}, attributes)

	// --- ...and kept its identity ---------------------------------------------
	assert.True(t, before.Metadata.CreatedAt.Equal(after.Metadata.CreatedAt),
		"created_at moved from %s to %s", before.Metadata.CreatedAt, after.Metadata.CreatedAt)

	membershipAfter, err := stmts.GetTeamMembership(t.Context(), f.project.ID, f.team.ID, userID)
	require.NoError(t, err, "the team membership is still there")
	assert.Equal(t, membershipBefore, membershipAfter)

	linkAfter, err := f.linkFor(t, "sub-migrant")
	require.NoError(t, err, "the identity link is still there")
	assert.Equal(t, linkBefore, linkAfter)

	t.Run("signs in with the password", func(t *testing.T) {
		attemptID := newAttempt(t, f.client, f.project)
		identified := verifyAttemptProof(t, f.client, attemptID, api.ChallengeMethodIdentifier, identifierProof(email))
		require.Equal(t, userID, identifiedUser(t, identified))
		passworded := verifyAttemptProof(t, f.client, attemptID, api.ChallengeMethodPassword, &api.VerifyChallengeRequest{
			OneOf: api.NewPasswordProofVerifyChallengeRequestSum(api.PasswordProof{Password: password}),
		})
		require.Contains(t, completedMethods(passworded), api.FactorMethodPassword)

		handoff, err := f.client.CreateHandoff(t.Context(), api.CreateHandoffParams{AttemptID: attemptID})
		require.NoError(t, err)
		require.IsType(t, &api.HandoffResponse{}, handoff, helpers.MustMarshal(t, handoff))
	})

	t.Run("signs in with the passkey", func(t *testing.T) {
		flow := f.startFlow(t, "")
		issued, err := f.client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{Action: "passkey"},
			api.SubmitFlowStepParams{ID: flow.id, Zflow: flow.zflow, Origin: api.NewOptURI(*rpOrigin)})
		require.NoError(t, err)
		require.IsType(t, &api.SubmitFlowStepOK{}, issued, helpers.MustMarshal(t, issued))
		issuedOK := issued.(*api.SubmitFlowStepOK)
		challenge, ok := issuedOK.Response.Step.Challenge.Get()
		require.True(t, ok, "the passkey action issues a challenge")
		challengeID, ok := challenge.ChallengeID.Get()
		require.True(t, ok, "the challenge carries its id")

		optionsJSON, err := json.Marshal(challenge.Options.Value)
		require.NoError(t, err)
		options, err := virtualwebauthn.ParseAssertionOptions(string(optionsJSON))
		require.NoError(t, err)
		var proof api.FlowSubmitRequestChallengeResponseProof
		require.NoError(t, json.Unmarshal([]byte(virtualwebauthn.CreateAssertionResponse(rp, authenticator, credential, *options)), &proof))

		verified, err := f.client.SubmitFlowStep(t.Context(), &api.FlowSubmitRequest{
			Action: "passkey",
			ChallengeResponse: api.NewOptFlowSubmitRequestChallengeResponse(api.FlowSubmitRequestChallengeResponse{
				ChallengeID: api.NewOptString(challengeID),
				Method:      api.NewOptString("passkey"),
				Proof:       api.NewOptFlowSubmitRequestChallengeResponseProof(proof),
			}),
		}, api.SubmitFlowStepParams{ID: flow.id, Zflow: mustExtractZflow(t, issuedOK.SetCookie)})
		require.NoError(t, err)
		require.IsType(t, &api.SubmitFlowStepOK{}, verified, helpers.MustMarshal(t, verified))
		assert.True(t, verified.(*api.SubmitFlowStepOK).Response.HandoffToken.Set, "a passkey sign-in hands off")
		userFactor, ok := domain.CheckAs[*domain.AuthFactorUser](f.attempt(t, flow), domain.AuthCheckTypeUser)
		require.True(t, ok)
		assert.Equal(t, userID, userFactor.UserID)
	})

	t.Run("signs in with SSO", func(t *testing.T) {
		flow := f.startFlow(t, "")
		parkSSOResult(t, f.project.ID, flow.attemptID, f.connection.RevisionID, "sub-migrant",
			map[string]any{"email": email}, map[string]bool{"email": true})

		requireAuthenticated(t, f.getStep(t, flow))
		userFactor, ok := domain.CheckAs[*domain.AuthFactorUser](f.attempt(t, flow), domain.AuthCheckTypeUser)
		require.True(t, ok)
		assert.Equal(t, userID, userFactor.UserID, "the link resolves to the migrated user")
	})
}
