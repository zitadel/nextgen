package domain_test

import (
	"testing"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
)

// conflictStep is the sso-conflict step `zitadel sso enable` writes: a
// password, a passkey and a way out to sign in as someone else.
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
// collision retargeted to the conflict step, as `zitadel sso enable` does.
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
}

// A declared re-purpose drops the password a register leg banked without
// checking it, so create_user cannot hand it to whoever the flow resolves
// next.
func TestFlowStateMachine_Process_RePurposeDropsBankedRegisterPassword(t *testing.T) {
	t.Parallel()
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

	result, err := w.sm.Process(t.Context(), def, banked.State, domain.FlowSubmitInput{Action: "sign_in"})
	require.NoError(t, err)
	assert.Equal(t, "identifier", result.State.CurrentStep)
	assert.Empty(t, result.State.CollectedData.AuthMethods.Password)
}

// A step that routes to itself while the outcome flips the purpose is a new
// variant of the step, so it still gets a back entry to the old one.
func TestFlowStateMachine_Process_SelfTransitionWithPurposeFlipPushes(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := purposeNavDefinition()
	for i := range def.Steps {
		if def.Steps[i].Name == "register" {
			def.Steps[i].Transitions[domain.FlowImplicitOutcomeUserAlreadyExists] = domain.FlowStepTransition{Target: "register"}
		}
	}
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().SubmitIdentifier(gomock.Any(), gomock.Any()).Return("user_alice", nil)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "alice@example.com"},
	})
	require.NoError(t, err)
	assert.Equal(t, "register", result.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, result.State.CurrentPurpose)
	assert.Equal(t, []domain.FlowBackEntry{{StepName: "register", Purpose: domain.FlowDefinitionPurposeRegister}}, result.State.BackStack)
}

func TestFlowStateMachine_Process_ConflictWrongPasswordKeepsUserBound(t *testing.T) {
	t.Parallel()
	w, def, state := conflictWorld(t)
	w.authAttemptService.EXPECT().
		SubmitPassword(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitPasswordInput) bool {
			return in.AttemptID == "attempt-1" && in.Plain == "not-the-password"
		})).
		Return(domain.ErrAuthAttemptProofRejected(nil))
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Process(t.Context(), def, state, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "not-the-password"},
	})
	require.NoError(t, err)
	assert.Equal(t, "sso-conflict", result.Step.Name)
	require.NotNil(t, result.Step.Error)
	assert.Equal(t, domain.FlowStepErrorInvalidCredentials, *result.Step.Error)
	assert.Equal(t, "user_alice", result.State.CollectedData.UserID)
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

// A step's own on_success runs after its password verified and still reads
// it: on such a step the verified password is not dropped.
func TestFlowStateMachine_Process_VerifiedPasswordReachesSameStepOnSuccess(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := purposeNavDefinition()
	createUser := domain.FlowOnSuccessCreateUser
	for i := range def.Steps {
		if def.Steps[i].Name == "password" {
			def.Steps[i].OnSuccess = &createUser
		}
	}
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().SubmitIdentifier(gomock.Any(), gomock.Any()).Return("user_alice", nil)
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Return(nil)
	w.createUser.EXPECT().
		Handle(gomock.Any(), gomock.Cond(func(in domain.FlowOnSuccessInput) bool {
			return in.State.CollectedData.AuthMethods.Password == "correct-horse-battery-staple"
		})).
		Return(domain.FlowOnSuccessResult{}, nil)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Return(domain.FlowHandoffOutput{Token: "handoff_01TEST"}, nil)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	identified, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "alice@example.com"},
	})
	require.NoError(t, err)
	require.Equal(t, "password", identified.State.CurrentStep)

	result, err := w.sm.Process(t.Context(), def, identified.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	assert.Equal(t, "handoff_01TEST", result.HandoffToken)
}

// A flow can reach the conflict step without binding a user.
// A password there has nobody to be checked against: it is dropped and the
// step asks the person to sign in, rather than failing the request.
func TestFlowStateMachine_Process_ConflictPasswordWithoutUserAsksToSignIn(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := conflictDefinition()
	def.Purposes[domain.FlowDefinitionPurposeLogin] = "sso-conflict"
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Times(0)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.Equal(t, "sso-conflict", start.State.CurrentStep)

	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	assert.Equal(t, "sso-conflict", result.Step.Name)
	require.NotNil(t, result.Step.Error)
	assert.Equal(t, domain.FlowStepErrorSignInFirst, *result.Step.Error)
	assert.Empty(t, result.State.CollectedData.AuthMethods.Password)
	assert.Empty(t, result.HandoffToken)
}

// A provider identity that collides with the bound user again re-renders the
// conflict step in place: no history entry, so back still leads out of it
// rather than to itself.
func TestFlowStateMachine_Render_SSOCollisionOnConflictStepDoesNotGrowBackStack(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def.Steps[0].Transitions[domain.FlowImplicitOutcomeUserAlreadyExists] = domain.FlowStepTransition{Target: "sso-conflict"}
	// The provider button on the conflict step is what parks this result.
	step := conflictStep()
	step.SSOProviders = []string{"google"}
	step.Transitions[domain.FlowImplicitOutcomeSSOAuthenticated] = domain.FlowStepTransition{Target: "done"}
	def.Steps = append(def.Steps, step)
	w.ssoProviders.EXPECT().
		Resolve(gomock.Any(), testProjectID, "sso-conflict", gomock.Any()).
		Return([]domain.FlowSSOProvider{{ID: "google", Name: "Google"}}, nil).
		AnyTimes()
	state.CurrentStep = "sso-conflict"
	state.CurrentPurpose = domain.FlowDefinitionPurposeLogin
	state.CollectedData.UserID = "u-b"
	state.History = []string{"credentials"}
	state.BackStack = []domain.FlowBackEntry{{StepName: "credentials", Purpose: domain.FlowDefinitionPurposeRegister}}
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.expectOwner("email", "alice@example.com", "u-b")
	w.expectBindCollision("u-b", nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-conflict", result.Step.Name)
	assert.Equal(t, "u-b", result.State.CollectedData.UserID)
	assert.Equal(t, []string{"credentials"}, result.State.History)
	assert.Equal(t, []domain.FlowBackEntry{{StepName: "credentials", Purpose: domain.FlowDefinitionPurposeRegister}}, result.State.BackStack)
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
