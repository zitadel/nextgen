package flowengine_test

import (
	"testing"
	"time"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/flowengine"
)

// navigateOnlyDefinition is a minimal multi-step fixture used by the
// back-navigation tests: step1 → step2 → done routed by navigate-kind
// actions, with no fields, challenges, or on_success. Keeps the
// back-nav tests free of auth-attempt and schema mocks.
func navigateOnlyDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-back-nav",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "step1",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "step1",
				Actions: []domain.FlowStepAction{
					{Name: "go", Kind: domain.FlowActionKindNavigate, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"go": {Target: "step2"},
				},
			},
			{
				Name: "step2",
				Actions: []domain.FlowStepAction{
					{Name: "go", Kind: domain.FlowActionKindNavigate, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					"go": {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

func TestFlowStateMachine_Back_NotInjectedOnInitialStep(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := navigateOnlyDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.Equal(t, "step1", start.Step.Name)
	assert.Empty(t, start.State.BackStack, "back stack must be empty on the initial step")
	assert.Nil(t, findBackAction(start.Step), "back action must not appear on the initial step")
}

func TestFlowStateMachine_Back_InjectedAfterAdvance(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := navigateOnlyDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{Action: "go"})
	require.NoError(t, err)
	require.Equal(t, "step2", result.Step.Name)
	require.Len(t, result.State.BackStack, 1)
	assert.Equal(t, "step1", result.State.BackStack[0].StepName)
	assert.Equal(t, []string{"step1"}, result.State.History)

	back := findBackAction(result.Step)
	if assert.NotNil(t, back, "back action must be injected after the first advance") {
		assert.Equal(t, "step2.action.back", back.TextKey)
		assert.False(t, back.Primary, "back must never be primary")
	}
}

func TestFlowStateMachine_Back_OmittedOnTerminalStep(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := navigateOnlyDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	mid, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{Action: "go"})
	require.NoError(t, err)
	term, err := w.sm.Process(t.Context(), def, mid.State, flowengine.FlowSubmitInput{Action: "go"})
	require.NoError(t, err)

	require.Equal(t, "done", term.Step.Name)
	require.NotNil(t, term.Step.Complete)
	assert.Empty(t, term.State.BackStack, "terminate must clear the back stack — no back past a point-of-no-return")
	assert.Nil(t, findBackAction(term.Step), "terminal step must not carry an injected back action")
}

func TestFlowStateMachine_Back_PopsAndRendersPreviousStep(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := navigateOnlyDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	advanced, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{Action: "go"})
	require.NoError(t, err)
	require.Equal(t, "step2", advanced.Step.Name)

	back, err := w.sm.Process(t.Context(), def, advanced.State, flowengine.FlowSubmitInput{Action: "back"})
	require.NoError(t, err)
	require.Equal(t, "step1", back.Step.Name)
	assert.Empty(t, back.State.BackStack, "back-stack pops on back submission")
	// History is append-only; the audit trail still records that step1 was visited.
	assert.Equal(t, []string{"step1"}, back.State.History)
	assert.Nil(t, findBackAction(back.Step), "back action must be absent once the stack is empty")
}

func TestFlowStateMachine_Back_EmptyBackStackRejected(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := navigateOnlyDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Client-synthesized back on the initial step must be rejected.
	_, err = w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{Action: "back"})
	require.Error(t, err)
	assert.ErrorIs(t, err, domain.ErrFlowInvalidAction())
}

// TestFlowStateMachine_Back_RestoresPurposeAfterFlip regresses a bug
// where back popped the step but left CurrentPurpose flipped, so a
// re-submit of the same unknown identifier bypassed user_not_found.
func TestFlowStateMachine_Back_RestoresPurposeAfterFlip(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := loginRegisterFlipDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att-1", nil)
	// Unknown email → identifier dispatch rejects the proof.
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil)).
		Times(1)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.Equal(t, domain.FlowDefinitionPurposeLogin, start.State.CurrentPurpose)

	// Submit unknown email → user_not_found flips CurrentPurpose to register.
	afterSubmit, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": "ghost@example.com"},
	})
	require.NoError(t, err)
	require.Equal(t, "register", afterSubmit.Step.Name)
	require.Equal(t, domain.FlowDefinitionPurposeRegister, afterSubmit.State.CurrentPurpose)

	// Back must restore the identifier step AND the login purpose.
	afterBack, err := w.sm.Process(t.Context(), def, afterSubmit.State, flowengine.FlowSubmitInput{Action: "back"})
	require.NoError(t, err)
	assert.Equal(t, "identifier", afterBack.Step.Name)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, afterBack.State.CurrentPurpose, "back must restore the pre-flip purpose")
}

func TestFlowStateMachine_Back_StackClearedAfterCreateUser(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := signupDefinition()

	const userID = "user_01TEST"
	const email = "alice@example.com"
	const password = "correct-horse-battery-staple"

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil)).
		Times(1)
	// create_user signals Irreversible on success; test pins the signal.
	w.createUser.EXPECT().
		Handle(gomock.Any(), gomock.Any()).
		Return(domain.FlowOnSuccessResult{UserID: userID, Irreversible: true}, nil)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Any()).
		Return(domain.FlowHandoffOutput{Token: "handoff_01TEST", ExpiresAt: time.Unix(1700000060, 0).UTC()}, nil).
		Times(1)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	result, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{
			"email":                   email,
			"x-auth-methods#password": password,
		},
	})
	require.NoError(t, err)

	// History records the visit; the back stack is cleared because
	// create_user signaled an irreversible mutation.
	assert.Equal(t, []string{"credentials"}, result.State.History)
	assert.Empty(t, result.State.BackStack, "an irreversible on_success must drop the back stack")
}

// navigateThreeStepDefinition chains three navigable steps to a
// terminal, so a multi-hop back can pop the stack progressively.
func navigateThreeStepDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-back-nav-3",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "step1",
		},
		Steps: []domain.FlowDefinitionStep{
			{Name: "step1", Actions: []domain.FlowStepAction{{Name: "go", Kind: domain.FlowActionKindNavigate, Primary: true}}, Transitions: map[string]domain.FlowStepTransition{"go": {Target: "step2"}}},
			{Name: "step2", Actions: []domain.FlowStepAction{{Name: "go", Kind: domain.FlowActionKindNavigate, Primary: true}}, Transitions: map[string]domain.FlowStepTransition{"go": {Target: "step3"}}},
			{Name: "step3", Actions: []domain.FlowStepAction{{Name: "go", Kind: domain.FlowActionKindNavigate, Primary: true}}, Transitions: map[string]domain.FlowStepTransition{"go": {Target: "done"}}},
			{Name: "done", Complete: &show},
		},
	}
}

func TestFlowStateMachine_Back_MultiHopPopsProgressively(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := navigateThreeStepDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	s2, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{Action: "go"})
	require.NoError(t, err)
	s3, err := w.sm.Process(t.Context(), def, s2.State, flowengine.FlowSubmitInput{Action: "go"})
	require.NoError(t, err)
	require.Equal(t, "step3", s3.Step.Name)
	require.Len(t, s3.State.BackStack, 2)

	back1, err := w.sm.Process(t.Context(), def, s3.State, flowengine.FlowSubmitInput{Action: "back"})
	require.NoError(t, err)
	assert.Equal(t, "step2", back1.Step.Name)
	require.Len(t, back1.State.BackStack, 1)
	assert.NotNil(t, findBackAction(back1.Step))

	back2, err := w.sm.Process(t.Context(), def, back1.State, flowengine.FlowSubmitInput{Action: "back"})
	require.NoError(t, err)
	assert.Equal(t, "step1", back2.Step.Name)
	assert.Empty(t, back2.State.BackStack)
	assert.Nil(t, findBackAction(back2.Step), "back must be absent on the initial step after popping to it")
	// History records every forward visit; back does not rewind it.
	assert.Equal(t, []string{"step1", "step2"}, back2.State.History)
}

func TestFlowStateMachine_Back_PreservesCollectedData(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := loginRegisterFlipDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil)).
		Times(1)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	const email = "ghost@example.com"
	afterSubmit, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	require.Equal(t, "register", afterSubmit.Step.Name)

	afterBack, err := w.sm.Process(t.Context(), def, afterSubmit.State, flowengine.FlowSubmitInput{Action: "back"})
	require.NoError(t, err)
	require.Equal(t, "identifier", afterBack.Step.Name)
	// The email survives back so the previous form pre-fills.
	assert.Equal(t, email, afterBack.State.CollectedData.UserData["email"])
	require.NotEmpty(t, afterBack.Step.Fields)
	if emailField := findFieldByName(afterBack.Step.Fields, "email"); assert.NotNil(t, emailField) && emailField.Value != nil {
		assert.Equal(t, email, *emailField.Value, "identifier step must prefill from CollectedData on back")
	}
}

func TestFlowStateMachine_Back_DropsPendingChallenge(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := navigateOnlyDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	advanced, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{Action: "go"})
	require.NoError(t, err)

	// Simulate a ceremony pending on step2. The challenge id is bound to
	// step2; back must drop it so a downstream verify can't resurrect it
	// against a different step.
	advanced.State.PendingChallenge = &domain.FlowPendingChallenge{ID: "ch-1", Method: flowengine.FlowChallengeMethodPasskey}

	afterBack, err := w.sm.Process(t.Context(), def, advanced.State, flowengine.FlowSubmitInput{Action: "back"})
	require.NoError(t, err)
	assert.Equal(t, "step1", afterBack.Step.Name)
	assert.Nil(t, afterBack.State.PendingChallenge, "back must drop the pending challenge")
}

// Regression: back restoration across a purposed navigation is existing
// behavior (FlowBackEntry snapshots the purpose) — navigating to register
// and going back must land on identifier with CurrentPurpose login again.
func TestFlowStateMachine_Process_BackRestoresPurposeAcrossSwitch(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := purposeNavDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	toRegister, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: "register",
	})
	require.NoError(t, err)
	require.Equal(t, domain.FlowDefinitionPurposeRegister, toRegister.State.CurrentPurpose)

	back, err := w.sm.Process(t.Context(), def, toRegister.State, flowengine.FlowSubmitInput{
		Action: "back",
	})
	require.NoError(t, err)
	assert.Equal(t, "identifier", back.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, back.State.CurrentPurpose,
		"back across a purposed navigation must restore the snapshotted purpose")
}

// TestFlowStateMachine_Back_ToIdentifierRotatesAuthAttempt replays the
// browser trace behind a "The user was already authenticated" report:
// identify, fail the password, go back, identify again. The first
// identification pins the user as a factor on the attempt, and
// PrepareUserChallenge refuses a second user challenge on a session-linked
// attempt — which every flow is, since the flow service links the attempt to
// the session it runs against. Back onto a step that re-collects the
// identifier must rotate the attempt in lockstep with dropping the resolved
// user, or the second identification dies.
func TestFlowStateMachine_Back_ToIdentifierRotatesAuthAttempt(t *testing.T) {
	t.Parallel()
	const email = "alice@example.com"
	w := newFlowTestWorld(t)
	def := purposeNavDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	gomock.InOrder(
		w.authAttemptService.EXPECT().
			Start(gomock.Any(), attemptFor(testProjectID, "sess-1")).
			Return("attempt-1", nil),
		w.authAttemptService.EXPECT().
			SubmitIdentifier(gomock.Any(), identifiedBy("attempt-1", "email", email)).
			Return("user_alice", nil),
		w.authAttemptService.EXPECT().
			SubmitPassword(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitPasswordInput) bool {
				return in.AttemptID == "attempt-1" && in.Plain == "not-the-password"
			})).
			Return(domain.ErrAuthAttemptProofRejected(nil)),
		w.authAttemptService.EXPECT().
			Start(gomock.Any(), attemptFor(testProjectID, "sess-1")).
			Return("attempt-2", nil),
		w.authAttemptService.EXPECT().
			SubmitIdentifier(gomock.Any(), identifiedBy("attempt-2", "email", email)).
			Return("user_alice", nil),
	)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	afterIdentify, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	require.Equal(t, "password", afterIdentify.State.CurrentStep)
	require.Equal(t, "user_alice", afterIdentify.State.CollectedData.UserID)

	// A rejected password holds the user on the step — this is what sends
	// them looking for the back action in the first place.
	afterWrongPassword, err := w.sm.Process(t.Context(), def, afterIdentify.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "not-the-password"},
	})
	require.NoError(t, err)
	require.Equal(t, "password", afterWrongPassword.State.CurrentStep)
	require.NotNil(t, afterWrongPassword.Step.Error)
	require.Equal(t, flowengine.FlowStepErrorInvalidCredentials, *afterWrongPassword.Step.Error)
	// mergeCollected banks the password before the proof is checked; the
	// sign-in submit drops it again rather than leaving it for whoever comes
	// next.
	require.Empty(t, afterWrongPassword.State.CollectedData.AuthMethods.Password)

	back, err := w.sm.Process(t.Context(), def, afterWrongPassword.State, flowengine.FlowSubmitInput{
		Action: "back",
	})
	require.NoError(t, err)
	require.Equal(t, "identifier", back.State.CurrentStep)
	assert.Equal(t, "attempt-2", back.State.AuthAttemptID,
		"back onto the identifier must rotate the auth attempt")
	assert.Empty(t, back.State.CollectedData.UserID,
		"the resolved user must not survive back onto the identifier")
	assert.Empty(t, back.State.CollectedData.AuthMethods.Password,
		"credential material collected for the dropped identity must go with it")
	assert.Equal(t, email, back.State.CollectedData.UserData["email"],
		"the identifier itself survives so the form prefills")

	// The whole point: re-identifying now lands on the rotated attempt
	// instead of dying on "The user was already authenticated".
	reIdentified, err := w.sm.Process(t.Context(), def, back.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	assert.Equal(t, "password", reIdentified.State.CurrentStep)
	assert.Equal(t, "user_alice", reIdentified.State.CollectedData.UserID)
}

// verificationChainDefinition puts a step behind the password so back can
// land somewhere that does not re-collect the identifier: identifier →
// password → confirm.
func verificationChainDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-verification-chain",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "identifier",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identifier",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionSubmit: {Target: "password"},
				},
			},
			{
				Name:   "password",
				Fields: []domain.Field{"x-auth-methods#password"},
				Actions: []domain.FlowStepAction{
					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionSubmit: {Target: "confirm"},
				},
			},
			{
				Name: "confirm",
				Actions: []domain.FlowStepAction{
					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionSubmit: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

// TestFlowStateMachine_Back_WithinVerificationKeepsAuthAttempt is the other
// half of the rule: back onto a step that does not re-collect the identifier
// leaves the resolved user — and so the attempt — alone. Rotating there would
// throw away verified factors the flow still needs.
func TestFlowStateMachine_Back_WithinVerificationKeepsAuthAttempt(t *testing.T) {
	t.Parallel()
	const email = "alice@example.com"
	w := newFlowTestWorld(t)
	def := verificationChainDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil).Times(1)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("user_alice", nil).
		Times(1)
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Return(nil).Times(1)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	afterIdentify, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	require.Equal(t, "password", afterIdentify.State.CurrentStep)

	afterPassword, err := w.sm.Process(t.Context(), def, afterIdentify.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "very-good-password-1"},
	})
	require.NoError(t, err)
	require.Equal(t, "confirm", afterPassword.State.CurrentStep)
	require.Equal(t, "user_alice", afterPassword.State.CollectedData.UserID)

	back, err := w.sm.Process(t.Context(), def, afterPassword.State, flowengine.FlowSubmitInput{
		Action: "back",
	})
	require.NoError(t, err)
	require.Equal(t, "password", back.State.CurrentStep)
	assert.Equal(t, "attempt-1", back.State.AuthAttemptID,
		"back within verification must not rotate the auth attempt")
	assert.Equal(t, "user_alice", back.State.CollectedData.UserID)
}

// TestFlowStateMachine_Back_AfterUserAlreadyExistsRotatesAuthAttempt covers
// the entry the shipped default flow actually offers: the sign-up tab, with
// an address that already has an account. The identifier lookup pins that
// user on the attempt and routes to verification via user_already_exists, so
// the attempt carries a user factor from that point on. Pressing back to fix
// the address must rotate, exactly as it does on the plain login path —
// otherwise the next address dies on "The user was already authenticated".
func TestFlowStateMachine_Back_AfterUserAlreadyExistsRotatesAuthAttempt(t *testing.T) {
	t.Parallel()
	const taken = "alice@example.com"
	const fresh = "bob@example.com"
	w := newFlowTestWorld(t)
	def := purposeNavDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	gomock.InOrder(
		w.authAttemptService.EXPECT().
			Start(gomock.Any(), attemptFor(testProjectID, "sess-1")).
			Return("attempt-1", nil),
		w.authAttemptService.EXPECT().
			SubmitIdentifier(gomock.Any(), identifiedBy("attempt-1", "email", taken)).
			Return("user_alice", nil),
		w.authAttemptService.EXPECT().
			Start(gomock.Any(), attemptFor(testProjectID, "sess-1")).
			Return("attempt-2", nil),
		w.authAttemptService.EXPECT().
			SubmitIdentifier(gomock.Any(), identifiedBy("attempt-2", "email", fresh)).
			Return("", domain.ErrAuthAttemptProofRejected(nil)),
	)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.Equal(t, "register", start.State.CurrentStep)

	flipped, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": taken},
	})
	require.NoError(t, err)
	require.Equal(t, "password", flipped.State.CurrentStep)
	require.Equal(t, domain.FlowDefinitionPurposeLogin, flipped.State.CurrentPurpose)
	require.Equal(t, "user_alice", flipped.State.CollectedData.UserID,
		"user_already_exists pins the user on the attempt, so the flow must record it")

	back, err := w.sm.Process(t.Context(), def, flipped.State, flowengine.FlowSubmitInput{
		Action: "back",
	})
	require.NoError(t, err)
	require.Equal(t, "register", back.State.CurrentStep)
	assert.Equal(t, "attempt-2", back.State.AuthAttemptID,
		"back after user_already_exists must rotate the auth attempt")
	assert.Empty(t, back.State.CollectedData.UserID)

	// A different address on the rotated attempt resolves normally; on the
	// old one it would have died on "The user was already authenticated".
	retried, err := w.sm.Process(t.Context(), def, back.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": fresh},
	})
	require.NoError(t, err)
	assert.Equal(t, "register-password", retried.State.CurrentStep,
		"an unknown address in register mode continues into registration")
}

// TestFlowStateMachine_Back_WithoutResolvedUserMintsNoAttempt keeps idle
// navigation free: back onto the identifier when nothing was resolved has
// nothing to rotate away from, and must not mint an attempt row per click.
func TestFlowStateMachine_Back_WithoutResolvedUserMintsNoAttempt(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := purposeNavDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil).Times(1)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil)).
		Times(1)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// user_not_found routes on to register with nothing resolved.
	flipped, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": "ghost@example.com"},
	})
	require.NoError(t, err)
	require.Equal(t, "register", flipped.State.CurrentStep)

	back, err := w.sm.Process(t.Context(), def, flipped.State, flowengine.FlowSubmitInput{
		Action: "back",
	})
	require.NoError(t, err)
	require.Equal(t, "identifier", back.State.CurrentStep)
	assert.Equal(t, "attempt-1", back.State.AuthAttemptID)
}
