package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

// multiStepSignupDefinition is worked example A: profile collects the
// identifier, set-password collects the credential, confirm-email runs
// create_user. The dispatch must keep moving through profile and
// set-password without verifying anything (mode is register), then let
// create_user run.
func multiStepSignupDefinition() *domain.FlowDefinition {
	createUser := domain.FlowOnSuccessCreateUser
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-multi-signup",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeRegister: "profile",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "profile",
				Fields: []string{"email"},
				Actions: map[string]domain.FlowStepAction{
					domain.FlowActionSubmit: {Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit:                     {Target: "set-password"},
					domain.FlowImplicitOutcomeUserAlreadyExists: {Target: "done"},
				},
			},
			{
				Name:   "set-password",
				Fields: []string{"password"},
				Actions: map[string]domain.FlowStepAction{
					domain.FlowActionSubmit: {Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "create"},
				},
			},
			{
				Name:      "create",
				Fields:    []string{"email", "password"},
				OnSuccess: &createUser,
				Actions: map[string]domain.FlowStepAction{
					domain.FlowActionSubmit: {Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

// combinedSigninSignupDefinition is worked example C: a single identify
// entry serves both login and register, with explicit user_not_found
// and user_already_exists transitions to wire the flip.
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
				Fields: []string{"email"},
				Actions: map[string]domain.FlowStepAction{
					domain.FlowActionSubmit: {Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit:                     {Target: "signin-password"},
					domain.FlowImplicitOutcomeUserNotFound:      {Target: "register-password"},
					domain.FlowImplicitOutcomeUserAlreadyExists: {Target: "signin-password"},
				},
			},
			{
				Name:   "signin-password",
				Fields: []string{"password"},
				Actions: map[string]domain.FlowStepAction{
					domain.FlowActionSubmit: {Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "done"},
				},
			},
			{
				Name:      "register-password",
				Fields:    []string{"email", "password"},
				OnSuccess: &createUser,
				Actions: map[string]domain.FlowStepAction{
					domain.FlowActionSubmit: {Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

// recoveryDefinition is worked example D: identifier verifies (user must
// exist to recover), but the new credential collected on new-password is
// never dispatched — recovery mode skips credential verification.
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
				Fields: []string{"email"},
				Actions: map[string]domain.FlowStepAction{
					domain.FlowActionSubmit: {Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit:                {Target: "new-password"},
					domain.FlowImplicitOutcomeUserNotFound: {Target: "done"},
				},
			},
			{
				Name:   "new-password",
				Fields: []string{"password"},
				Actions: map[string]domain.FlowStepAction{
					domain.FlowActionSubmit: {Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

// Worked example A: register mode, multi-step signup. profile collects
// the identifier and SubmitIdentifier returns user-not-found (the email
// is free) — dispatch continues without emitting an outcome, the flow
// moves to set-password and then to create.
func TestFlowDispatch_RegisterMultiStep_HappyPath(t *testing.T) {
	w := newFlowTestWorld(t)
	def := multiStepSignupDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// profile → user_not_found is expected for a free email; flow advances.
	afterProfile, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "fresh@example.com"},
	})
	require.NoError(t, err)
	assert.Equal(t, "set-password", afterProfile.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, afterProfile.State.CurrentPurpose)
	require.Len(t, w.attempts.identifyCalls, 1)
	assert.Empty(t, w.attempts.passwordCalls, "set-password not yet visited")

	// set-password collects the credential; register mode skips password dispatch.
	afterPassword, err := w.sm.Process(t.Context(), nil, def, afterProfile.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	assert.Equal(t, "create", afterPassword.State.CurrentStep)
	assert.Empty(t, w.attempts.passwordCalls, "register mode never verifies password")

	// create runs create_user; both identifier and password are owned by the manifest.
	done, err := w.sm.Process(t.Context(), nil, def, afterPassword.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":    "fresh@example.com",
			"password": "correct-horse-battery-staple",
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "done", done.State.CurrentStep)
	require.Len(t, w.users.created, 1)
}

// Worked example A variant: register entry, identifier already exists.
// Dispatch emits user_already_exists and flips CurrentPurpose to login.
func TestFlowDispatch_RegisterEntry_IdentifierAlreadyExists_Flips(t *testing.T) {
	w := newFlowTestWorld(t)
	w.attempts.identifierResult = map[string]string{
		"taken@example.com": "user_existing",
	}
	def := multiStepSignupDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "taken@example.com"},
	})
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, result.State.CurrentPurpose,
		"register + user_already_exists flips CurrentPurpose to login")
	assert.Equal(t, "done", result.State.CurrentStep,
		"profile routes user_already_exists to its wired target")
}

// Worked example C: login entry, unknown email. Dispatch emits
// user_not_found, the flip moves CurrentPurpose to register, and the
// downstream register-password step skips password dispatch and runs
// create_user.
func TestFlowDispatch_CombinedFlow_LoginUnknownEmail_FlipsAndCreates(t *testing.T) {
	w := newFlowTestWorld(t)
	def := combinedSigninSignupDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	afterIdentify, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "ghost@example.com"},
	})
	require.NoError(t, err)
	assert.Equal(t, "register-password", afterIdentify.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, afterIdentify.State.CurrentPurpose)

	done, err := w.sm.Process(t.Context(), nil, def, afterIdentify.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":    "ghost@example.com",
			"password": "correct-horse-battery-staple",
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "done", done.State.CurrentStep)
	require.Len(t, w.users.created, 1, "register-password's create_user must have run")
	assert.Empty(t, w.attempts.passwordCalls, "register mode never verifies password")
}

// Worked example C variant: register entry, identifier already exists.
// Dispatch emits user_already_exists, flip moves CurrentPurpose to
// login, and signin-password verifies normally.
func TestFlowDispatch_CombinedFlow_RegisterKnownEmail_FlipsToSignin(t *testing.T) {
	w := newFlowTestWorld(t)
	w.attempts.identifierResult = map[string]string{
		"alice@example.com": "user_alice",
	}
	def := combinedSigninSignupDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	afterIdentify, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "alice@example.com"},
	})
	require.NoError(t, err)
	assert.Equal(t, "signin-password", afterIdentify.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, afterIdentify.State.CurrentPurpose)

	done, err := w.sm.Process(t.Context(), nil, def, afterIdentify.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	assert.Equal(t, "done", done.State.CurrentStep)
	require.Len(t, w.attempts.passwordCalls, 1, "login mode verifies password")
}

// Worked example D: recovery flow. Identifier dispatches and resolves a
// real user; the new password collected on new-password is never
// dispatched (recovery mode skips credential verification).
func TestFlowDispatch_Recovery_IdentifierResolvedPasswordNotDispatched(t *testing.T) {
	w := newFlowTestWorld(t)
	w.attempts.identifierResult = map[string]string{
		"alice@example.com": "user_alice",
	}
	def := recoveryDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRecovery,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	afterIdentify, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "alice@example.com"},
	})
	require.NoError(t, err)
	assert.Equal(t, "new-password", afterIdentify.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRecovery, afterIdentify.State.CurrentPurpose,
		"recovery never flips")
	require.Len(t, w.attempts.identifyCalls, 1)

	_, err = w.sm.Process(t.Context(), nil, def, afterIdentify.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"password": "fresh-secret"},
	})
	require.NoError(t, err)
	assert.Empty(t, w.attempts.passwordCalls, "recovery mode never verifies password")
}

// Worked example B is exercised by TestFlowStateMachine_Process_RegistrationHappyPath
// in flow_state_machine_test.go: a single step owning both email +
// password with on_success: create_user. The current step's manifest
// covers the password kind so dispatch skips it even if the mode check
// were relaxed.
