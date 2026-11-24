package flowengine_test

import (
	"testing"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/flowengine"
)

// TestFlowStateMachine_Start_PreservesActionOrder pins ADR 021: the rendered
// step's Actions list reflects the definition order, not Go map iteration.
func TestFlowStateMachine_Start_PreservesActionOrder(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil)
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)

	show := domain.FlowStepCompleteShow
	def := &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-order",
		UserSchema: defaultSchemaURL,
		Purposes:   map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeLogin: "step"},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "step",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: flowengine.ActionPasskey},
					{Name: flowengine.ActionSubmit, Primary: true},
					{Name: "register"},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.ActionPasskey: {Target: "done"},
					flowengine.ActionSubmit:  {Target: "done"},
					"register":               {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}

	result, err := w.sm.Start(t.Context(), flowengine.StartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.SessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	gotNames := make([]string, len(result.Step.Actions))
	for i, a := range result.Step.Actions {
		gotNames[i] = a.Name
	}
	assert.Equal(t, []string{flowengine.ActionPasskey, flowengine.ActionSubmit, "register"}, gotNames)
}

// twoStepLoginDefinition collects the identifier and the password on
// separate steps.
func twoStepLoginDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-two-step-login",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "identifier",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identifier",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: flowengine.ActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.ActionSubmit:                {Target: "password"},
					domain.FlowImplicitOutcomeUserNotFound: {Target: "done"},
				},
			},
			{
				Name:   "password",
				Fields: []domain.Field{"x-auth-methods#password"},
				Actions: []domain.FlowStepAction{
					{Name: flowengine.ActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.ActionSubmit: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

func TestFlowStateMachine_TwoStepLogin_PasswordStepPairsTheIdentifier(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	const email = "alice@example.com"
	const attemptID = "att_01TEST"

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return(attemptID, nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("user_alice", nil).
		Times(1)

	def := twoStepLoginDefinition()

	start, err := w.sm.Start(t.Context(), flowengine.StartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.SessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.NotNil(t, start.Step)
	require.Equal(t, "identifier", start.Step.Name)

	require.Len(t, start.Step.Fields, 1)
	assert.Equal(t, "email", start.Step.Fields[0].Name)
	assert.Equal(t, domain.AutocompleteUsername, start.Step.Fields[0].Autocomplete)
	assert.Nil(t, start.Step.Identifier)

	result, err := w.sm.Process(t.Context(), def, start.State, flowengine.SubmitInput{
		Action: flowengine.ActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "password", result.Step.Name)

	require.Len(t, result.Step.Fields, 1)
	assert.Equal(t, domain.AutocompleteCurrentPassword, result.Step.Fields[0].Autocomplete)

	require.NotNil(t, result.Step.Identifier)
	assert.Equal(t, email, result.Step.Identifier.Value)
	assert.Equal(t, domain.AutocompleteUsername, result.Step.Identifier.Autocomplete)

	// Render-only: submitting it back would re-resolve the identifier.
	assert.False(t, containsFieldName(result.Step.Fields, "email"))
}

// The case a client cannot cover for itself: the widget keeps collected
// values in memory only, while GET /flows/{flow_id} re-renders from flow state.
func TestFlowStateMachine_RenderAfterReload_StillPairsTheIdentifier(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	const email = "alice@example.com"

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_01TEST", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("user_alice", nil).
		Times(1)

	def := twoStepLoginDefinition()

	start, err := w.sm.Start(t.Context(), flowengine.StartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.SessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	advanced, err := w.sm.Process(t.Context(), def, start.State, flowengine.SubmitInput{
		Action: flowengine.ActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	require.Equal(t, "password", advanced.Step.Name)

	// Re-render the same state, as a page reload does. Every render reads
	// the attempt for a parked SSO identity; there is none here.
	w.ssoIdentities.EXPECT().LoadParked(gomock.Any(), gomock.Any()).Return(nil, nil)
	reloaded, err := w.sm.Render(t.Context(), def, advanced.State)
	require.NoError(t, err)
	require.NotNil(t, reloaded.Step)
	require.Equal(t, "password", reloaded.Step.Name)

	require.NotNil(t, reloaded.Step.Identifier)
	assert.Equal(t, email, reloaded.Step.Identifier.Value)
	require.Len(t, reloaded.Step.Fields, 1)
	assert.Equal(t, domain.AutocompleteCurrentPassword, reloaded.Step.Fields[0].Autocomplete)
	assert.Nil(t, reloaded.Step.Fields[0].Validation,
		"a sign-in step carries no length rule: a stored password may predate a stricter policy")
	assert.Zero(t, w.passwords.calls, "a sign-in step does not read the password policy")
}

func TestFlowStateMachine_MultiStepRegister_PasswordStepIsANewPassword(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	const email = "newcomer@example.com"
	const attemptID = "att_01TEST"

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return(attemptID, nil)
	// Not finding the identifier is the path on to the password step.
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil)).
		Times(1)

	def := multiStepSignupDefinition()

	start, err := w.sm.Start(t.Context(), flowengine.StartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.SessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.Equal(t, "profile", start.Step.Name)

	result, err := w.sm.Process(t.Context(), def, start.State, flowengine.SubmitInput{
		Action: flowengine.ActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "set-password", result.Step.Name)

	require.Len(t, result.Step.Fields, 1)
	assert.Equal(t, domain.AutocompleteNewPassword, result.Step.Fields[0].Autocomplete)

	require.NotNil(t, result.Step.Identifier)
	assert.Equal(t, email, result.Step.Identifier.Value)
}

func TestFlowStateMachine_SingleCardLogin_NeedsNoPairingHint(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_01TEST", nil)

	def := loginDefinition()

	start, err := w.sm.Start(t.Context(), flowengine.StartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       flowengine.SessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.NotNil(t, start.Step)

	// One card collects both, so the identifier is already in the form.
	assert.Nil(t, start.Step.Identifier)

	byName := map[string]string{}
	for _, f := range start.Step.Fields {
		byName[f.Name] = f.Autocomplete
	}
	assert.Equal(t, domain.AutocompleteUsername, byName["email"])
	assert.Equal(t, domain.AutocompleteCurrentPassword, byName["x-auth-methods#password"])

	// Signing in verifies the password the user has: no policy bounds, and
	// the policy is not read at all.
	for _, f := range start.Step.Fields {
		if f.Name == "x-auth-methods#password" {
			assert.Nil(t, f.Validation)
		}
	}
	assert.Zero(t, w.passwords.calls)
}
