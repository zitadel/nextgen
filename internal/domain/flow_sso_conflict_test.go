package domain_test

import (
	"testing"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
)

// conflictStep is the sso-conflict step `zitadel auth-method sso enable`
// writes: a password, a passkey and a way out to sign in as someone else.
func conflictStep() domain.FlowDefinitionStep {
	login := domain.FlowDefinitionPurposeLogin
	return domain.FlowDefinitionStep{
		Name:   "sso-conflict",
		Fields: []domain.Field{"x-auth-methods#password"},
		Actions: []domain.FlowStepAction{
			{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
			{Name: domain.FlowActionPasskey, Kind: domain.FlowActionKindPasskey},
			{Name: "sign_in", Kind: domain.FlowActionKindNavigate},
		},
		Transitions: map[string]domain.FlowStepTransition{
			domain.FlowActionSubmit:                     {Target: "done"},
			domain.FlowActionPasskey:                    {Target: "done"},
			domain.FlowImplicitOutcomeUserAlreadyExists: {Target: "sso-conflict"},
			"sign_in": {Target: "identifier", Purpose: &login},
		},
	}
}

// conflictDefinition is purposeNavDefinition with a typed registration
// collision retargeted to the conflict step, as `zitadel auth-method sso
// enable` does.
func conflictDefinition() *domain.FlowDefinition {
	def := purposeNavDefinition()
	for i := range def.Steps {
		if def.Steps[i].Name == "register" {
			def.Steps[i].Transitions[domain.FlowImplicitOutcomeUserAlreadyExists] = domain.FlowStepTransition{Target: "sso-conflict"}
		}
	}
	def.Steps = append(def.Steps, conflictStep())
	return def
}

// conflictWorld starts a login flow, switches to sign-up and types an email
// alice already owns, which lands on the conflict step bound to her.
func conflictWorld(t *testing.T) (*flowTestWorld, *domain.FlowDefinition, *domain.FlowState) {
	t.Helper()
	w := newFlowTestWorld(t)
	def := conflictDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), attemptFor(testProjectID, "sess-1")).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), identifiedBy("attempt-1", "email", "alice@example.com")).
		Return("user_alice", nil)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	toRegister, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{Action: "register"})
	require.NoError(t, err)
	conflict, err := w.sm.Process(t.Context(), def, toRegister.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "alice@example.com"},
	})
	require.NoError(t, err)
	require.Equal(t, "sso-conflict", conflict.State.CurrentStep)
	require.Equal(t, "user_alice", conflict.State.CollectedData.UserID)
	require.Equal(t, domain.FlowDefinitionPurposeLogin, conflict.State.CurrentPurpose)
	return w, def, conflict.State
}

// sign_in releases the bound account and rotates the attempt. The identifier
// step still offers back, which lands on the conflict step with nobody bound:
// a password there asks the person to sign in instead of failing the request,
// as the conflict step without a bound user does (#1041 §5).
func TestFlowStateMachine_Process_ConflictBackAfterSignInAsksToSignIn(t *testing.T) {
	t.Parallel()
	w, def, state := conflictWorld(t)
	w.authAttemptService.EXPECT().Start(gomock.Any(), attemptFor(testProjectID, "sess-1")).Return("attempt-2", nil)
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Times(0)

	identifier, err := w.sm.Process(t.Context(), def, state, domain.FlowSubmitInput{Action: "sign_in"})
	require.NoError(t, err)
	assert.Equal(t, "identifier", identifier.State.CurrentStep)
	assert.Empty(t, identifier.State.CollectedData.UserID)
	assert.Equal(t, "attempt-2", identifier.State.AuthAttemptID, "releasing the account must rotate the auth attempt")
	// Back is still offered here; removing it is #1041 AC #7, deferred until
	// back entries remember the account they were shown for. Until then this
	// pins that the way back ends in a step error, not an API error.
	require.NotNil(t, findBackAction(identifier.Step))

	back, err := w.sm.Process(t.Context(), def, identifier.State, domain.FlowSubmitInput{Action: "back"})
	require.NoError(t, err)
	require.Equal(t, "sso-conflict", back.State.CurrentStep)
	assert.Empty(t, back.State.CollectedData.UserID)

	result, err := w.sm.Process(t.Context(), def, back.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	assert.Equal(t, "sso-conflict", result.Step.Name)
	require.NotNil(t, result.Step.Error)
	assert.Equal(t, domain.FlowStepErrorSignInFirst, *result.Step.Error)
	assert.Empty(t, result.State.CollectedData.AuthMethods.Password, "a password with nobody to check it against is not kept")
}

// bankedRegisterPassword starts a register flow whose register step collects
// the password with the email, so the password is banked unchecked when the
// flow moves on to register-password.
func bankedRegisterPassword(t *testing.T) (*flowTestWorld, *domain.FlowDefinition, *domain.FlowState) {
	t.Helper()
	w := newFlowTestWorld(t)
	def := purposeNavDefinition()
	login := domain.FlowDefinitionPurposeLogin
	for i := range def.Steps {
		switch def.Steps[i].Name {
		case "register":
			def.Steps[i].Fields = []domain.Field{"email", "x-auth-methods#password"}
		case "register-password":
			def.Steps[i].Actions = append(def.Steps[i].Actions, domain.FlowStepAction{Name: "sign_in", Kind: domain.FlowActionKindNavigate})
			def.Steps[i].Transitions["sign_in"] = domain.FlowStepTransition{Target: "identifier", Purpose: &login}
		}
	}
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().SubmitIdentifier(gomock.Any(), gomock.Any()).Return("", domain.ErrAuthAttemptProofRejected(nil))
	w.createUser.EXPECT().Handle(gomock.Any(), gomock.Any()).Times(0)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	banked, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "new@example.com", "x-auth-methods#password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	require.Equal(t, "register-password", banked.State.CurrentStep)
	require.Equal(t, "correct-horse-battery-staple", banked.State.CollectedData.AuthMethods.Password)
	return w, def, banked.State
}

// A declared re-purpose drops the password a register leg banked without
// checking it, so create_user cannot hand it to whoever the flow resolves
// next.
func TestFlowStateMachine_Process_RePurposeDropsBankedRegisterPassword(t *testing.T) {
	t.Parallel()
	w, def, state := bankedRegisterPassword(t)

	result, err := w.sm.Process(t.Context(), def, state, domain.FlowSubmitInput{Action: "sign_in"})
	require.NoError(t, err)
	assert.Equal(t, "identifier", result.State.CurrentStep)
	assert.Empty(t, result.State.CollectedData.AuthMethods.Password)
}

// Back onto a step that collects the identifier drops the banked password the
// same way.
func TestFlowStateMachine_Process_BackToIdentificationDropsBankedPassword(t *testing.T) {
	t.Parallel()
	w, def, state := bankedRegisterPassword(t)

	result, err := w.sm.Process(t.Context(), def, state, domain.FlowSubmitInput{Action: "back"})
	require.NoError(t, err)
	assert.Equal(t, "register", result.State.CurrentStep)
	assert.Empty(t, result.State.CollectedData.AuthMethods.Password)
}

// The bound user's password signs in, and the verified password is not kept
// in the flow state afterwards.
func TestFlowStateMachine_Process_ConflictPasswordSignsInAndDropsPassword(t *testing.T) {
	t.Parallel()
	w, def, state := conflictWorld(t)
	w.authAttemptService.EXPECT().
		SubmitPassword(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitPasswordInput) bool {
			return in.AttemptID == "attempt-1" && in.Plain == "correct-horse-battery-staple"
		})).
		Return(nil)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Return(domain.FlowHandoffOutput{Token: "handoff_01TEST"}, nil)

	result, err := w.sm.Process(t.Context(), def, state, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step.Complete)
	assert.Equal(t, "handoff_01TEST", result.HandoffToken)
	assert.Equal(t, "user_alice", result.State.CollectedData.UserID)
	assert.Empty(t, result.State.CollectedData.AuthMethods.Password)
}

// A passkey on the conflict step signs in the bound user: the ceremony runs on
// the attempt that carries her, which scopes it to her credentials, and the
// verified passkey follows the step's passkey transition.
func TestFlowStateMachine_Process_ConflictPasskeySignsInBoundUser(t *testing.T) {
	t.Parallel()
	const challengeID = "ch-1"
	const proof = `{"id":"x"}`
	w, def, state := conflictWorld(t)
	w.authAttemptService.EXPECT().
		IssuePasskeyChallenge(gomock.Any(), gomock.Cond(func(in domain.FlowIssuePasskeyChallengeInput) bool {
			return in.AttemptID == "attempt-1"
		})).
		Return(domain.FlowPasskeyChallengeOutput{ChallengeID: challengeID, Options: []byte(`{"publicKey":{}}`)}, nil)
	w.authAttemptService.EXPECT().
		SubmitPasskey(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitPasskeyInput) bool {
			return in.ChallengeID == challengeID && string(in.Assertion) == proof
		})).
		Return("user_alice", nil)
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Times(0)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Return(domain.FlowHandoffOutput{Token: "handoff_01TEST"}, nil)

	issued, err := w.sm.Process(t.Context(), def, state, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.Step.Challenge)
	assert.Equal(t, "sso-conflict", issued.State.CurrentStep)

	verified, err := w.sm.Process(t.Context(), def, issued.State, domain.FlowSubmitInput{
		Action:            domain.FlowActionPasskey,
		ChallengeResponse: &domain.FlowChallengeResponse{ChallengeID: challengeID, Method: "passkey", Proof: []byte(proof)},
	})
	require.NoError(t, err)
	require.NotNil(t, verified.Step.Complete)
	assert.Equal(t, "handoff_01TEST", verified.HandoffToken)
	assert.Equal(t, "user_alice", verified.State.CollectedData.UserID)
}

// ssoConflictWorld is ssoRenderWorld whose sign-in step routes a collision to
// a conflict step shaped like the one `zitadel auth-method sso enable` writes:
// a password, a passkey, and both providers.
func ssoConflictWorld(t *testing.T) (*flowTestWorld, *domain.FlowDefinition, *domain.FlowState) {
	t.Helper()
	w, def, state := ssoRenderWorld(t)
	def.Steps[0].Transitions[domain.FlowImplicitOutcomeUserAlreadyExists] = domain.FlowStepTransition{Target: "sso-conflict"}
	step := conflictStep()
	step.SSOProviders = []string{"google", "github"}
	step.Transitions[domain.FlowImplicitOutcomeSSOAuthenticated] = domain.FlowStepTransition{Target: "done"}
	delete(step.Transitions, "sign_in")
	step.Actions = step.Actions[:2]
	def.Steps = append(def.Steps, step)
	w.ssoProviders.EXPECT().
		Resolve(gomock.Any(), testProjectID, "sso-conflict", []string{"google", "github"}).
		Return([]domain.FlowSSOProvider{
			{ID: "google", Name: "Google", ConnectionID: "idp-1"},
			{ID: "github", Name: "GitHub", ConnectionID: "idp-2"},
		}, nil).
		AnyTimes()
	return w, def, state
}

func conflictParked(verified bool) *domain.FlowSSOParkedIdentity {
	return &domain.FlowSSOParkedIdentity{
		CheckID:      "ch-1",
		ConnectionID: "idp-1",
		Subject:      "sub-1",
		Claims:       map[string]any{"email": "alice@example.com"},
		Verified:     map[string]bool{"email": verified},
	}
}

func providerIDs(providers []domain.FlowSSOProvider) []string {
	ids := make([]string, 0, len(providers))
	for _, p := range providers {
		ids = append(ids, p.ID)
	}
	return ids
}

func hasAction(step *domain.FlowStep, name string) bool {
	for _, a := range step.Actions {
		if a.Name == name {
			return true
		}
	}
	return false
}

// After a provider's email collides, the conflict step names the account by
// the address the provider verified, leaves out the provider that collided,
// and offers a passkey only to an account that has one.
func TestFlowStateMachine_Render_SSOConflictNamesVerifiedAccountAndDropsCollidingProvider(t *testing.T) {
	t.Parallel()
	w, def, state := ssoConflictWorld(t)
	w.expectParked(conflictParked(true), nil)
	w.expectOwner("email", "alice@example.com", "user-9")
	w.expectBindCollision("user-9", nil)
	w.ssoIdentities.EXPECT().UserHasPasskey(gomock.Any(), testProjectID, "user-9").Return(false, nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	require.Equal(t, "sso-conflict", result.Step.Name)
	require.NotNil(t, result.Step.Identifier)
	assert.Equal(t, "alice@example.com", result.Step.Identifier.Value)
	assert.Equal(t, []string{"github"}, providerIDs(result.Step.SSOProviders), "the provider that collided is not offered again")
	assert.False(t, hasAction(result.Step, domain.FlowActionPasskey), "an account without a passkey is not offered one")
	assert.True(t, hasAction(result.Step, domain.FlowActionSubmit))
	assert.Equal(t, "idp-1", result.State.CollectedData.SSOConflictConnectionID)
}

// An email the provider did not verify is not shown: the visitor has not
// proved they hold it. The passkey stays for an account that has one.
func TestFlowStateMachine_Render_SSOConflictDoesNotNameUnverifiedAccount(t *testing.T) {
	t.Parallel()
	w, def, state := ssoConflictWorld(t)
	w.expectParked(conflictParked(false), nil)
	w.expectOwner("email", "alice@example.com", "user-9")
	w.expectBindCollision("user-9", nil)
	w.ssoIdentities.EXPECT().UserHasPasskey(gomock.Any(), testProjectID, "user-9").Return(true, nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	require.Equal(t, "sso-conflict", result.Step.Name)
	assert.Nil(t, result.Step.Identifier)
	assert.Equal(t, []string{"github"}, providerIDs(result.Step.SSOProviders))
	assert.True(t, hasAction(result.Step, domain.FlowActionPasskey))
}

// An address typed earlier on the flow that is not the one that collided
// would name another account, so it is dropped.
func TestFlowStateMachine_Render_SSOConflictDropsOtherTypedIdentifier(t *testing.T) {
	t.Parallel()
	w, def, state := ssoConflictWorld(t)
	state.CollectedData.UserData = map[string]any{"email": "someone-else@example.com"}
	w.expectParked(conflictParked(false), nil)
	w.expectOwner("email", "alice@example.com", "user-9")
	w.expectBindCollision("user-9", nil)
	w.ssoIdentities.EXPECT().UserHasPasskey(gomock.Any(), testProjectID, "user-9").Return(true, nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	require.Equal(t, "sso-conflict", result.Step.Name)
	assert.Nil(t, result.Step.Identifier)
}

// Releasing the bound user releases what the collision recorded with it.
func TestFlowStateMachine_Process_SSOConflictClearedWithBoundUser(t *testing.T) {
	t.Parallel()
	w, def, state := conflictWorld(t)
	state.CollectedData.SSOConflictConnectionID = "idp-1"
	w.authAttemptService.EXPECT().Start(gomock.Any(), attemptFor(testProjectID, "sess-1")).Return("attempt-2", nil)

	result, err := w.sm.Process(t.Context(), def, state, domain.FlowSubmitInput{Action: "sign_in"})
	require.NoError(t, err)
	assert.Empty(t, result.State.CollectedData.SSOConflictConnectionID)
}
