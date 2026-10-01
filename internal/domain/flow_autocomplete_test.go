package domain_test

import (
	"testing"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestAutocompleteForField(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		field   domain.FlowField
		purpose domain.FlowDefinitionPurpose
		want    string
	}{
		{
			name:    "an email-typed identifier takes the email token",
			field:   domain.FlowField{Challenge: domain.FlowFieldChallengeIdentifier, Type: domain.FlowFieldTypeEmail},
			purpose: domain.FlowDefinitionPurposeLogin,
			want:    domain.AutocompleteEmail,
		},
		{
			// The designation, not the property name, makes a field the
			// identifier — so a tenant calling it `handle` still pairs.
			name:    "a text-typed identifier takes the username token",
			field:   domain.FlowField{Name: "handle", Challenge: domain.FlowFieldChallengeIdentifier, Type: domain.FlowFieldTypeText},
			purpose: domain.FlowDefinitionPurposeLogin,
			want:    domain.AutocompleteUsername,
		},
		{
			name:    "a password the engine verifies takes current-password",
			field:   domain.FlowField{Challenge: domain.FlowFieldChallengePassword, Type: domain.FlowFieldTypePassword},
			purpose: domain.FlowDefinitionPurposeLogin,
			want:    domain.AutocompleteCurrentPassword,
		},
		{
			name:    "a password the engine saves takes new-password",
			field:   domain.FlowField{Challenge: domain.FlowFieldChallengePassword, Type: domain.FlowFieldTypePassword},
			purpose: domain.FlowDefinitionPurposeRegister,
			want:    domain.AutocompleteNewPassword,
		},
		{
			name:    "a recovery password is a new one too",
			field:   domain.FlowField{Challenge: domain.FlowFieldChallengePassword, Type: domain.FlowFieldTypePassword},
			purpose: domain.FlowDefinitionPurposeRecovery,
			want:    domain.AutocompleteNewPassword,
		},
		{
			name:    "a plain property takes no token",
			field:   domain.FlowField{Name: "given_name", Type: domain.FlowFieldTypeText},
			purpose: domain.FlowDefinitionPurposeRegister,
			want:    "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tc.want, domain.AutocompleteForField(tc.field, tc.purpose))
		})
	}
}

// twoStepLoginDefinition collects the identifier and the password on
// separate steps — the shape that leaves a password manager nothing to pair
// unless the password step carries the identifier back.
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
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit:                {Target: "password"},
					domain.FlowImplicitOutcomeUserNotFound: {Target: "done"},
				},
			},
			{
				Name:   "password",
				Fields: []domain.Field{"x-auth-methods#password"},
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "done"},
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.NotNil(t, start.Step)
	require.Equal(t, "identifier", start.Step.Name)

	// The identifier step carries its own token and needs no pairing hint:
	// the field it renders is the identifier.
	require.Len(t, start.Step.Fields, 1)
	assert.Equal(t, "email", start.Step.Fields[0].Name)
	assert.Equal(t, domain.AutocompleteEmail, start.Step.Fields[0].Autocomplete)
	assert.Nil(t, start.Step.Identifier)

	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "password", result.Step.Name)

	require.Len(t, result.Step.Fields, 1)
	assert.Equal(t, domain.AutocompleteCurrentPassword, result.Step.Fields[0].Autocomplete)

	// The password step declares no identifier field, so the engine hands
	// the collected one back for the form to carry alongside the password.
	require.NotNil(t, result.Step.Identifier)
	assert.Equal(t, "email", result.Step.Identifier.Name)
	assert.Equal(t, email, result.Step.Identifier.Value)
	assert.Equal(t, domain.AutocompleteUsername, result.Step.Identifier.Autocomplete)

	// The hint is render-only: it must not become a field the client
	// submits back, or dispatch would re-resolve the identifier.
	assert.False(t, containsFieldName(result.Step.Fields, "email"))
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
	// Registration looks the identifier up to detect a collision; not
	// finding one is the path that continues to the password step.
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil)).
		Times(1)

	def := multiStepSignupDefinition()

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.Equal(t, "profile", start.Step.Name)

	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "set-password", result.Step.Name)

	require.Len(t, result.Step.Fields, 1)
	assert.Equal(t, domain.AutocompleteNewPassword, result.Step.Fields[0].Autocomplete)

	// A manager saves the pair on registration too, so the hint applies
	// wherever the password is collected on its own.
	require.NotNil(t, result.Step.Identifier)
	assert.Equal(t, "email", result.Step.Identifier.Name)
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.NotNil(t, start.Step)

	// One card collects both, so the identifier is already an input in the
	// form the manager reads.
	assert.Nil(t, start.Step.Identifier)

	byName := map[string]string{}
	for _, f := range start.Step.Fields {
		byName[f.Name] = f.Autocomplete
	}
	assert.Equal(t, domain.AutocompleteEmail, byName["email"])
	assert.Equal(t, domain.AutocompleteCurrentPassword, byName["x-auth-methods#password"])
}
