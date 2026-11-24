package flowengine_test

import (
	"testing"
	"time"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/flowengine"
)

func TestFlowStateMachine_Process_IntegrityOnMissingTargetStep(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil))
	w.createUser.EXPECT().
		Handle(gomock.Any(), gomock.Any()).
		Return(flowengine.FlowOnSuccessResult{UserID: "user-id1"}, nil)

	def := signupDefinition()
	// Mutate the submit transition to point at a non-existent step.
	def.Steps[0].Transitions[flowengine.FlowActionSubmit] = domain.FlowStepTransition{Target: "nope"}

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	_, err = w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{
			"email":                   "alice@example.com",
			"x-auth-methods#password": "correct-horse-battery-staple",
		},
	})
	require.ErrorIs(t, err, domain.ErrFlowIntegrity())
}

func TestFlowStateMachine_FlipTable_LoginUserNotFoundFlipsToRegister(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := loginDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil))

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, start.State.CurrentPurpose)

	result, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": "ghost@example.com", "x-auth-methods#password": "irrelevant"},
	})
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, result.State.Purpose, "Purpose stays pinned")
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, result.State.CurrentPurpose)
}

func TestFlowStateMachine_FlipTable_RecoveryPassthrough(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil))

	def := loginDefinition()
	delete(def.Purposes, domain.FlowDefinitionPurposeLogin)
	def.Purposes[domain.FlowDefinitionPurposeRecovery] = "credentials"

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRecovery,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": "ghost@example.com", "x-auth-methods#password": "irrelevant"},
	})
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionPurposeRecovery, result.State.CurrentPurpose)
}

// passkeyIdentifierDefinition mirrors the default login flow's identifier
// step: an email field plus `submit` (→ password) and `passkey` (→ done)
// actions, with `user_not_found` routing to a register step. Lets a test
// drive the passkey-issue path with an unknown email so the early dispatch
// short-circuits and the engine routes via user_not_found.
func passkeyIdentifierDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-passkey-identifier",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin:    "identifier",
			domain.FlowDefinitionPurposeRegister: "register",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identifier",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
					{Name: flowengine.FlowActionPasskey, Kind: domain.FlowActionKindPasskey},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionSubmit:            {Target: "password"},
					flowengine.FlowActionPasskey:           {Target: "done"},
					domain.FlowImplicitOutcomeUserNotFound: {Target: "register"},
				},
			},
			{
				Name:   "password",
				Fields: []domain.Field{"x-auth-methods#password"},
				Actions: []domain.FlowStepAction{
					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionSubmit: {Target: "done"},
				},
			},
			{
				Name:   "register",
				Fields: []domain.Field{"email"},
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

// TestFlowStateMachine_FlipTable_PasskeyIssue_UnknownEmail_FlipsToRegister
// pins the bug where selecting `passkey` on the identifier step with an
// unknown email routed via `user_not_found` to the register step but left
// CurrentPurpose pinned at `login`. The next submit then ran identifier
// verification in login mode and rejected the same email as user_not_found
// again. Mirrors the flip the non-passkey dispatch path already applies.
func TestFlowStateMachine_FlipTable_PasskeyIssue_UnknownEmail_FlipsToRegister(t *testing.T) {
	t.Parallel()

	const attemptID = "attempt-1"
	const email = "ghost@example.com"

	w := newFlowTestWorld(t)
	def := passkeyIdentifierDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return(attemptID, nil)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil)).
		Times(1)
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge[flowengine.FlowPasskeyChallengeParams](nil)).
		Times(0)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, start.State.CurrentPurpose)

	result, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskey,
		Fields:    map[string]any{"email": email},
		PasskeyRP: &flowengine.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	assert.Equal(t, "register", result.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, result.State.Purpose, "Purpose stays pinned")
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, result.State.CurrentPurpose,
		"early-passkey dispatch must flip CurrentPurpose on user_not_found, parity with the non-passkey path")
	assert.Nil(t, result.State.PendingChallenge, "passkey challenge must not be issued when identifier dispatch already produced an outcome")
}

// loginNoUserNotFoundDefinition is a login-only flow whose identifier
// step does NOT wire a user_not_found transition. Lets a test exercise
// the "outcome without a transition" path.
func loginNoUserNotFoundDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-login-no-unf",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "credentials",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "credentials",
				Fields: []domain.Field{"email", "x-auth-methods#password"},
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

// TestFlowStateMachine_FlipTable_OutcomeWithoutTransition_DoesNotFlip
// pins the invariant that CurrentPurpose flips only when a flip outcome
// is actually routed. Dispatch returns the flip outcome but the step has
// no transition for it; the engine re-renders the step with the outcome's
// localized error and the mode must stay put so the next submit doesn't
// silently dispatch as the partner purpose.
func TestFlowStateMachine_FlipTable_OutcomeWithoutTransition_DoesNotFlip(t *testing.T) {
	t.Parallel()
	const attemptID = "attempt-1"

	tests := []struct {
		name        string
		def         *domain.FlowDefinition
		purpose     domain.FlowDefinitionPurpose
		userID      string
		submitErr   error
		wantError   string
		wantAttempt string
	}{
		{
			name:        "login-only flow with an unknown identifier",
			def:         loginNoUserNotFoundDefinition(),
			purpose:     domain.FlowDefinitionPurposeLogin,
			submitErr:   domain.ErrAuthAttemptProofRejected(nil),
			wantError:   flowengine.FlowStepErrorUserNotFound,
			wantAttempt: attemptID,
		},
		{
			// The attempt holds the found user, so a corrected identifier
			// needs a new one.
			name:        "register-only flow with a known identifier",
			def:         signupDefinition(),
			purpose:     domain.FlowDefinitionPurposeRegister,
			userID:      "user_alice",
			wantError:   flowengine.FlowStepErrorUserAlreadyExists,
			wantAttempt: "attempt-2",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			w := newFlowTestWorld(t)

			w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return(attemptID, nil)
			if tt.wantAttempt != attemptID {
				w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return(tt.wantAttempt, nil)
			}
			w.schemaResolver.EXPECT().
				Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
				Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
				AnyTimes()
			w.authAttemptService.EXPECT().
				SubmitIdentifier(gomock.Any(), gomock.Any()).
				Return(tt.userID, tt.submitErr)

			start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
				Definition:    tt.def,
				Purpose:       tt.purpose,
				Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
				UserSchemaURL: defaultSchemaURL,
			})
			require.NoError(t, err)

			result, err := w.sm.Process(t.Context(), tt.def, start.State, flowengine.FlowSubmitInput{
				Action: flowengine.FlowActionSubmit,
				Fields: map[string]any{"email": "alice@example.com", "x-auth-methods#password": "s3cret-pass"},
			})
			require.NoError(t, err)
			assert.Equal(t, "credentials", result.State.CurrentStep, "an unwired outcome keeps the user on the current step")
			if assert.NotNil(t, result.Step.Error) {
				assert.Equal(t, tt.wantError, *result.Step.Error)
			}
			assert.Equal(t, tt.purpose, result.State.CurrentPurpose,
				"CurrentPurpose must not flip when the routed outcome had no transition wired")
			assert.Empty(t, result.State.CollectedData.UserID)
			assert.Equal(t, tt.wantAttempt, result.State.AuthAttemptID)
			// A later step may not collect the password again, and create_user
			// fails without it.
			assert.Equal(t, "s3cret-pass", result.State.CollectedData.AuthMethods[domain.AuthMethodPassword])
		})
	}
}

// TestFlowStateMachine_FlipTable_LoginTypoThenCorrectEmail_StillSignsIn
// is the user-visible motivation for the no-phantom-flip invariant. The
// user mistypes their email on a login-only flow with no user_not_found
// transition; the engine renders a step error and the user retries with
// the correct (existing) address. Without the gate, CurrentPurpose would
// have flipped to register on the typo and the second attempt would see
// the known email as user_already_exists, wedging the sign-in.
func TestFlowStateMachine_FlipTable_LoginTypoThenCorrectEmail_StillSignsIn(t *testing.T) {
	t.Parallel()

	const attemptID = "attempt-1"
	const email = "ghost@example.com"
	const userID = "user_alice"
	const incorrectPassword = "irrelevant"
	const correctPassword = "correct-horse-battery-staple"
	const handoffToken = "handoff_01TEST"

	w := newFlowTestWorld(t)
	def := loginNoUserNotFoundDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return(attemptID, nil)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in flowengine.FlowSubmitIdentifierInput) bool {
			return attemptID == in.AttemptID && in.AttributeName == "email" && email == in.Value
		})).
		Return(userID, nil).
		AnyTimes()
	w.authAttemptService.EXPECT().
		SubmitPassword(gomock.Any(), gomock.Cond(func(in flowengine.FlowSubmitPasswordInput) bool {
			return attemptID == in.AttemptID && in.Plain == incorrectPassword
		})).
		Return(domain.ErrAuthAttemptProofRejected(nil)).
		Times(1)
	w.authAttemptService.EXPECT().
		SubmitPassword(gomock.Any(), gomock.Cond(func(in flowengine.FlowSubmitPasswordInput) bool {
			return attemptID == in.AttemptID && in.Plain == correctPassword
		})).
		Return(nil).
		Times(1)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Return(flowengine.FlowHandoffOutput{
		Token:     handoffToken,
		ExpiresAt: time.Unix(1700000060, 0).UTC(),
	}, nil)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Typo: dispatch returns user_not_found, no transition wired,
	// engine surfaces a step error and the user stays on credentials.
	typo, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": email, "x-auth-methods#password": incorrectPassword},
	})
	require.NoError(t, err)
	require.Equal(t, "credentials", typo.State.CurrentStep)
	require.NotNil(t, typo.Step.Error)
	require.Equal(t, domain.FlowDefinitionPurposeLogin, typo.State.CurrentPurpose,
		"phantom flip on the typo would wedge the retry below")

	// Retry with the correct (known) email: still in login mode, so
	// identifier resolves, password verifies, and the user signs in.
	result, err := w.sm.Process(t.Context(), def, typo.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": email, "x-auth-methods#password": correctPassword},
	})
	require.NoError(t, err)
	assert.Equal(t, "done", result.State.CurrentStep)
	assert.Equal(t, "user_alice", result.State.CollectedData.UserID)
	assert.Equal(t, handoffToken, result.HandoffToken, "handoff issued for completed sign-in")
}

// combinedSigninSignupDefinition is worked example C.
func combinedSigninSignupDefinition() *domain.FlowDefinition {
	createUser := domain.FlowOnSuccessCreateUser
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-combined",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin:    "identify",
			domain.FlowDefinitionPurposeRegister: "identify",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identify",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionSubmit:                 {Target: "signin-password"},
					domain.FlowImplicitOutcomeUserNotFound:      {Target: "register-password"},
					domain.FlowImplicitOutcomeUserAlreadyExists: {Target: "signin-password"},
				},
			},
			{
				Name:   "signin-password",
				Fields: []domain.Field{"x-auth-methods#password"},
				Actions: []domain.FlowStepAction{
					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionSubmit: {Target: "done"},
				},
			},
			{
				Name:      "register-password",
				Fields:    []domain.Field{"x-auth-methods#password"},
				OnSuccess: &createUser,
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

// recoveryDefinition is worked example D.
func recoveryDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-recovery",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeRecovery: "identify",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identify",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionSubmit:            {Target: "new-password"},
					domain.FlowImplicitOutcomeUserNotFound: {Target: "done"},
				},
			},
			{
				Name:   "new-password",
				Fields: []domain.Field{"x-auth-methods#password"},
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

// Worked example A: register-mode multi-step; identifier on profile,
// password on set-password, create_user on `create`.
func TestFlowDispatch_RegisterMultiStep_HappyPath(t *testing.T) {
	t.Parallel()
	const email = "fresh@example.com"

	w := newFlowTestWorld(t)
	def := multiStepSignupDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil)).
		Times(1)
	w.createUser.EXPECT().
		Handle(gomock.Any(), gomock.Cond(func(in flowengine.FlowOnSuccessInput) bool {
			return in.State.CollectedData.UserData["email"] == email
		})).
		Return(flowengine.FlowOnSuccessResult{UserID: "user-id1"}, nil)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Any()).
		Return(flowengine.FlowHandoffOutput{
			Token:     "handoff_01TEST",
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		}, nil)
	// register mode never verifies password
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Times(0)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	afterProfile, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	assert.Equal(t, "set-password", afterProfile.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, afterProfile.State.CurrentPurpose)

	afterPassword, err := w.sm.Process(t.Context(), def, afterProfile.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	assert.Equal(t, "create", afterPassword.State.CurrentStep)

	done, err := w.sm.Process(t.Context(), def, afterPassword.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
	})
	require.NoError(t, err)
	assert.Equal(t, "done", done.State.CurrentStep)
}

// Register entry, identifier already exists → user_already_exists +
// flip to login.
func TestFlowDispatch_RegisterEntry_IdentifierAlreadyExists_Flips(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("user_existing", nil)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Any()).
		Return(flowengine.FlowHandoffOutput{Token: "handoff_01TEST"}, nil)

	def := multiStepSignupDefinition()

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": "taken@example.com"},
	})
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, result.State.CurrentPurpose)
	assert.Equal(t, "done", result.State.CurrentStep)
	assert.Equal(t, "user_existing", result.State.CollectedData.UserID,
		"the identifier lookup pinned this user on the attempt, so the flow must know it too")
	assert.Equal(t, "handoff_01TEST", result.HandoffToken,
		"terminate gates the handoff on a resolved user; without one the sign-in ends tokenless")
}

// Worked example C: login entry, unknown email → flip + create_user runs.
func TestFlowDispatch_CombinedFlow_LoginUnknownEmail_FlipsAndCreates(t *testing.T) {
	t.Parallel()
	const email = "ghost@example.com"
	w := newFlowTestWorld(t)
	def := combinedSigninSignupDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil))
	w.createUser.EXPECT().
		Handle(gomock.Any(), gomock.Cond(func(in flowengine.FlowOnSuccessInput) bool {
			return in.State.CollectedData.UserData["email"] == email
		})).
		Return(flowengine.FlowOnSuccessResult{UserID: "user-id1"}, nil)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Any()).
		Return(flowengine.FlowHandoffOutput{
			Token:     "handoff_01TEST",
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		}, nil)

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
	assert.Equal(t, "register-password", afterIdentify.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, afterIdentify.State.CurrentPurpose)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, start.Step.Purpose)
	assert.Nil(t, start.Step.Notice)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, afterIdentify.Step.Purpose)
	require.NotNil(t, afterIdentify.Step.Notice, "the user asked to sign in, so the sign-up says why")
	assert.Equal(t, flowengine.FlowStepNoticeUserNotFound, *afterIdentify.Step.Notice)

	w.ssoIdentities.EXPECT().LoadParked(gomock.Any(), gomock.Any()).Return(nil, nil)
	rendered, err := w.sm.Render(t.Context(), def, afterIdentify.State)
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, rendered.Step.Purpose)
	assert.Nil(t, rendered.Step.Notice, "the notice belongs to the move, not to the step")

	done, err := w.sm.Process(t.Context(), def, afterIdentify.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	assert.Equal(t, "done", done.State.CurrentStep)
}

// Worked example C variant: register entry, identifier exists → flip
// to login + signin-password verifies.
func TestFlowDispatch_CombinedFlow_RegisterKnownEmail_FlipsToSignin(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("user_alice", nil)
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Times(1)
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Any()).
		Return(flowengine.FlowHandoffOutput{Token: "handoff_01TEST"}, nil)

	def := combinedSigninSignupDefinition()

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	afterIdentify, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": "alice@example.com"},
	})
	require.NoError(t, err)
	assert.Equal(t, "signin-password", afterIdentify.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, afterIdentify.State.CurrentPurpose)
	assert.Equal(t, "user_alice", afterIdentify.State.CollectedData.UserID,
		"the flip pins the found user on the attempt, so the flow must know it too")
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, afterIdentify.Step.Purpose)
	require.NotNil(t, afterIdentify.Step.Notice, "the user asked to sign up, so the sign-in says why")
	assert.Equal(t, flowengine.FlowStepNoticeUserAlreadyExists, *afterIdentify.Step.Notice)

	done, err := w.sm.Process(t.Context(), def, afterIdentify.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	assert.Equal(t, "done", done.State.CurrentStep)
	// Signing up with an address that already has an account is still a
	// sign-in: it has to end with a token to exchange for a session.
	assert.Equal(t, "handoff_01TEST", done.HandoffToken)
}

// Worked example D: recovery identifies but never verifies password.
func TestFlowDispatch_Recovery_IdentifierResolvedPasswordNotDispatched(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("user_alice", nil).
		Times(1)
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Times(0)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Any()).
		Return(flowengine.FlowHandoffOutput{
			Token:     "handoff_01TEST",
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		}, nil)

	def := recoveryDefinition()

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRecovery,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	afterIdentify, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": "alice@example.com"},
	})
	require.NoError(t, err)
	assert.Equal(t, "new-password", afterIdentify.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRecovery, afterIdentify.State.CurrentPurpose)

	_, err = w.sm.Process(t.Context(), def, afterIdentify.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "fresh-secret"},
	})
	require.NoError(t, err)
}

// TestFlowStateMachine_Process_NavigateSkipsValidation verifies that a
// navigate-kind action on a step with required fields routes via its
// transition without running field validation. This is the engine's
// half of ADR 026 — a back-navigation action can be invoked with empty
// fields and the engine must not block on missing email/password.
func TestFlowStateMachine_Process_NavigateSkipsValidation(t *testing.T) {
	t.Parallel()

	const attemptID = "attempt-1"

	w := newFlowTestWorld(t)
	show := domain.FlowStepCompleteShow
	def := &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-navigate",
		UserSchema: defaultSchemaURL,
		Purposes:   map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "enter"},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "enter",
				Fields: []domain.Field{"email", "x-auth-methods#password"},
				Actions: []domain.FlowStepAction{
					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
					{Name: "cancel", Kind: domain.FlowActionKindNavigate},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionSubmit: {Target: "done"},
					"cancel":                    {Target: "landing"},
				},
			},
			{Name: "landing", Complete: &show},
			{Name: "done", Complete: &show},
		},
	}

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return(attemptID, nil)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Empty fields would fail validation under a submit action; navigate
	// must skip validation and follow the transition.
	result, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: "cancel",
		Fields: map[string]any{},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	assert.Equal(t, "landing", result.Step.Name)
	assert.Nil(t, result.Step.Error, "navigate must not surface field-validation errors")
}

// TestFlowStateMachine_Process_SubmitKindRegression confirms that the
// kind-based dispatch keeps the standard submit pipeline intact — a
// malformed email under a submit action surfaces a field-validation error
// rather than routing through, exactly as before.
func TestFlowStateMachine_Process_SubmitKindRegression(t *testing.T) {
	t.Parallel()

	const attemptID = "attempt-1"

	w := newFlowTestWorld(t)
	def := loginDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return(attemptID, nil)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{
			"email":    "not-an-email",
			"password": "correct-horse-battery-staple",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "credentials", result.Step.Name)
	if assert.NotNil(t, result.Step.Error, "submit kind must still run field validation") {
		assert.Contains(t, *result.Step.Error, "email")
	}
}

// A navigate transition with a declared purpose moves CurrentPurpose in
// both directions while the pinned Purpose stays untouched — and, being
// navigate-kind, does so with empty fields and no validation.
func TestFlowStateMachine_Process_NavigatePurposeSwitch_BothDirections(t *testing.T) {
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
	require.Equal(t, domain.FlowDefinitionPurposeLogin, start.State.CurrentPurpose)

	toRegister, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: "register",
		Fields: map[string]any{},
	})
	require.NoError(t, err)
	assert.Equal(t, "register", toRegister.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, toRegister.State.CurrentPurpose)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, toRegister.State.Purpose,
		"the pinned Purpose must not move on a local re-purpose")
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, toRegister.Step.Purpose)
	assert.Nil(t, toRegister.Step.Notice, "the user chose to sign up, so there is nothing to explain")

	toLogin, err := w.sm.Process(t.Context(), def, toRegister.State, flowengine.FlowSubmitInput{
		Action: "sign_in",
		Fields: map[string]any{},
	})
	require.NoError(t, err)
	assert.Equal(t, "identifier", toLogin.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, toLogin.State.CurrentPurpose)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, toLogin.State.Purpose)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, toLogin.Step.Purpose)
	assert.Nil(t, toLogin.Step.Notice)
}

// A purpose-only transition goes to that purpose's entry step, exactly as
// one that also names the step does.
func TestFlowStateMachine_Process_NavigatePurposeSwitchWithoutTarget(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := purposeNavDefinition()
	login := domain.FlowDefinitionPurposeLogin
	register := domain.FlowDefinitionPurposeRegister
	def.Steps[0].Transitions["register"] = domain.FlowStepTransition{Purpose: &register}
	def.Steps[2].Transitions["sign_in"] = domain.FlowStepTransition{Purpose: &login}

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
		Fields: map[string]any{},
	})
	require.NoError(t, err)
	assert.Equal(t, "register", toRegister.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, toRegister.State.CurrentPurpose)

	toLogin, err := w.sm.Process(t.Context(), def, toRegister.State, flowengine.FlowSubmitInput{
		Action: "sign_in",
		Fields: map[string]any{},
	})
	require.NoError(t, err)
	assert.Equal(t, "identifier", toLogin.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, toLogin.State.CurrentPurpose)
}

// Navigating away abandons a pending passkey ceremony: without the
// explicit clear on the navigate path the stale challenge survives in
// state and re-attaches on the next render.
func TestFlowStateMachine_Process_NavigateClearsPendingChallenge(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := purposeNavDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		IssueChallenge(gomock.Any(), issuesChallenge[flowengine.FlowPasskeyChallengeParams](nil)).
		Return(flowengine.FlowIssuedChallenge{ChallengeID: "ch-1", Options: []byte(`{"publicKey":{}}`)}, nil)
	// navigation abandons the ceremony; no verification may run
	w.authAttemptService.EXPECT().VerifyChallenge(gomock.Any(), verifiesChallenge(domain.AuthCheckTypePasskey, nil)).Times(0)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	issued, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action:    flowengine.FlowActionPasskey,
		PasskeyRP: &flowengine.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	navigated, err := w.sm.Process(t.Context(), def, issued.State, flowengine.FlowSubmitInput{
		Action: "register",
	})
	require.NoError(t, err)
	assert.Equal(t, "register", navigated.State.CurrentStep)
	assert.Nil(t, navigated.State.PendingChallenge,
		"navigation must drop the abandoned ceremony from state")
	assert.Nil(t, navigated.Step.Challenge,
		"the rendered step must not re-attach the abandoned passkey challenge")
}

// After navigating login → register, the register leg must run with real
// register semantics: the unknown identifier reads as "fresh email", the
// password leg creates the user, and no password verification runs.
func TestFlowStateMachine_Process_RegistrationCompletesAfterNavSwitch(t *testing.T) {
	t.Parallel()
	const email = "fresh@example.com"
	w := newFlowTestWorld(t)
	def := purposeNavDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil)).
		Times(1)
	w.createUser.EXPECT().
		Handle(gomock.Any(), gomock.Cond(func(in flowengine.FlowOnSuccessInput) bool {
			return in.State.CollectedData.UserData["email"] == email
		})).
		Return(flowengine.FlowOnSuccessResult{UserID: "user-id1"}, nil)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Any()).
		Return(flowengine.FlowHandoffOutput{
			Token:     "handoff_01TEST",
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		}, nil)
	// register mode never verifies a password
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Times(0)

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

	afterEmail, err := w.sm.Process(t.Context(), def, toRegister.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	assert.Equal(t, "register-password", afterEmail.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, afterEmail.State.CurrentPurpose)

	done, err := w.sm.Process(t.Context(), def, afterEmail.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	assert.Equal(t, "done", done.State.CurrentStep)
}

// Security regression (review finding on #829): a declared re-purpose must
// not carry the previously resolved user across. Resolving an existing
// email in login mode, going back, and choosing "Sign up" used to leave
// CollectedData.UserID bound to the existing account — passkey
// registration would then attach a new credential to that account without
// proving a factor. The purposed transition clears user-bound state, and
// re-identifying the same email in register mode routes through
// user_already_exists into password verification instead.
func TestFlowStateMachine_Process_NavPurposeSwitchDropsResolvedUser(t *testing.T) {
	t.Parallel()
	const email = "alice@example.com"
	w := newFlowTestWorld(t)
	def := purposeNavDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	// The re-purpose must rotate the attempt: the first attempt carries
	// alice as a user factor and would reject a second user challenge
	// ("The user was already authenticated"). Each identify lands on its
	// own attempt.
	gomock.InOrder(
		w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil),
		w.authAttemptService.EXPECT().
			SubmitIdentifier(gomock.Any(), gomock.Cond(func(in flowengine.FlowSubmitIdentifierInput) bool {
				return in.AttemptID == "attempt-1"
			})).
			Return("user_alice", nil),
		w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-2", nil),
		w.authAttemptService.EXPECT().
			SubmitIdentifier(gomock.Any(), gomock.Cond(func(in flowengine.FlowSubmitIdentifierInput) bool {
				return in.AttemptID == "attempt-2"
			})).
			Return("user_alice", nil),
	)
	// The register leg must never issue a passkey registration or create a
	// user for the login-resolved account.
	w.authAttemptService.EXPECT().IssueChallenge(gomock.Any(), issuesChallenge[flowengine.FlowPasskeyChallengeParams](nil)).Times(0)
	w.createUser.EXPECT().Handle(gomock.Any(), gomock.Any()).Times(0)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Login mode resolves the existing user.
	afterIdentify, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	require.Equal(t, "password", afterIdentify.State.CurrentStep)
	require.Equal(t, "user_alice", afterIdentify.State.CollectedData.UserID)

	back, err := w.sm.Process(t.Context(), def, afterIdentify.State, flowengine.FlowSubmitInput{
		Action: "back",
	})
	require.NoError(t, err)
	require.Equal(t, "identifier", back.State.CurrentStep)

	// "Sign up" must start register mode fresh: no resolved user and no
	// collected credential material.
	toRegister, err := w.sm.Process(t.Context(), def, back.State, flowengine.FlowSubmitInput{
		Action: "register",
	})
	require.NoError(t, err)
	assert.Equal(t, "register", toRegister.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, toRegister.State.CurrentPurpose)
	assert.Equal(t, "attempt-2", toRegister.State.AuthAttemptID,
		"a re-purpose after identification must rotate the auth attempt")
	assert.Empty(t, toRegister.State.CollectedData.UserID,
		"the login-resolved user must not survive a declared re-purpose")
	assert.Empty(t, toRegister.State.CollectedData.AuthMethods[domain.AuthMethodPassword])

	// Re-identifying the same existing email in register mode routes
	// through user_already_exists into password verification.
	guarded, err := w.sm.Process(t.Context(), def, toRegister.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	assert.Equal(t, "password", guarded.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, guarded.State.CurrentPurpose,
		"user_already_exists must flip back to login for verification")
}

// Purpose-entry toggling is a zero-input loop; without coalescing, every
// Sign up / Sign in click appends History + BackStack and the encrypted
// state cookie blows past the 4 KiB browser budget (review measured
// 4,215 bytes after 50 toggles). An exact undo of the previous purposed
// navigation pops instead of pushing, so the state stays O(1) — and idle
// toggling (no user resolved) must not mint auth-attempt rows either.
func TestFlowStateMachine_Process_PurposeToggleDoesNotGrowState(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := purposeNavDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	// Exactly one attempt for the whole toggle storm: no resolved user,
	// no rotation.
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil).Times(1)

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	state := start.State
	for i := 0; i < 50; i++ {
		action := "register"
		if state.CurrentStep == "register" {
			action = "sign_in"
		}
		result, err := w.sm.Process(t.Context(), def, state, flowengine.FlowSubmitInput{Action: action})
		require.NoError(t, err)
		state = result.State
		require.LessOrEqual(t, len(state.BackStack), 1, "toggle %d must not grow the back stack", i)
		require.LessOrEqual(t, len(state.History), 1, "toggle %d must not grow the history", i)
	}

	// The loop ran an even number of toggles, so we are back on the login
	// entry with the state shaped exactly like a fresh start.
	assert.Equal(t, "identifier", state.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, state.CurrentPurpose)
	assert.Empty(t, state.BackStack)
	assert.Empty(t, state.History)
	assert.Equal(t, "attempt-1", state.AuthAttemptID)
}
