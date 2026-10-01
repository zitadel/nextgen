package domain_test

import (
	"context"
	"testing"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
)

func passwordField(t *testing.T, step *domain.FlowStep) domain.FlowField {
	t.Helper()
	for _, f := range step.Fields {
		if f.Name == "x-auth-methods#password" {
			return f
		}
	}
	t.Fatalf("step %q has no password field", step.Name)
	return domain.FlowField{}
}

// A password is verified on login, so the `user.password.save` constraints
// do not apply: a stored password that predates a stricter policy must
// still sign in (ADR 066).
func TestFlowStateMachine_LoginPasswordCarriesNoSaveRules(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().SubmitIdentifier(gomock.Any(), gomock.Any()).Return("user_alice", nil)
	w.authAttemptService.EXPECT().
		SubmitPassword(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, in domain.FlowSubmitPasswordInput) error {
			assert.Equal(t, "short1", in.Plain, "the short password reaches verification untouched")
			return domain.ErrAuthAttemptProofRejected(nil)
		})

	def := loginDefinition()
	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	assert.Nil(t, passwordField(t, start.Step).Validation, "a verified password renders without length rules")

	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "alice@example.com", "x-auth-methods#password": "short1"},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step.Error)
	assert.Equal(t, domain.FlowStepErrorInvalidCredentials, *result.Step.Error,
		"verification answers, not field validation")
}

// A password collected for create_user is saved, so the step keeps the
// save constraints and rejects a short one before any mutation.
func TestFlowStateMachine_RegistrationPasswordKeepsSaveRules(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)

	def := signupDefinition()
	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	validation := passwordField(t, start.Step).Validation
	require.NotNil(t, validation)
	assert.Equal(t, domain.PasswordMinLengthFloor, validation.MinLength)

	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "alice@example.com", "x-auth-methods#password": "short1"},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step.Error)
	expected := domain.FlowFieldValidationError{Field: "x-auth-methods#password", Rule: domain.FlowFieldValidationRuleMinLength}
	assert.Equal(t, expected.TextKey(), *result.Step.Error)
}

// The saved password's rules come from the project's policy, read with the
// flow's project id, so a published instance reaches the registration form.
func TestFlowStateMachine_RegistrationPasswordUsesProjectPolicy(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)

	var askedFor string
	w.sm.WithPasswordSaveRules(func(_ context.Context, projectID string) (*domain.FlowFieldValidation, error) {
		askedFor = projectID
		return &domain.FlowFieldValidation{MinLength: 8, MaxLength: 64}, nil
	})

	def := signupDefinition()
	def.ProjectID = "proj_policy"
	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	assert.Equal(t, "proj_policy", askedFor, "constraints are read for the flow's project")
	assert.Equal(t, &domain.FlowFieldValidation{MinLength: 8, MaxLength: 64}, passwordField(t, start.Step).Validation)
}
