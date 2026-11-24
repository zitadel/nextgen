package flowengine_test

import (
	"errors"
	"testing"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/flowengine"
)

func TestFlowStateMachine_Process_FieldValidationErrorKeepsStep(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := signupDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)

	start, err := w.sm.Start(t.Context(), flowengine.StartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.SessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), served(def), start.State, flowengine.SubmitInput{
		Action: flowengine.ActionSubmit,
		Fields: map[string]any{
			"email":                   "not-an-email",
			"x-auth-methods#password": "correct-horse-battery-staple",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "credentials", result.Step.Name)
	if assert.NotNil(t, result.Step.Error) {
		// The wire dialect end to end: format violations surface as the
		// `_invalid`-spelled text key, not a raw diagnostic string.
		assert.Equal(t, "error.email_invalid", *result.Step.Error)
	}
}

func TestFlowStateMachine_Process_OmittedRequiredFieldKeepsStep(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := signupDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)

	start, err := w.sm.Start(t.Context(), flowengine.StartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.SessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// The submit action collects the step's fields, so the required email
	// the client left out entirely must surface as a per-field error rather
	// than passing through to fail late at create_user.
	result, err := w.sm.Process(t.Context(), served(def), start.State, flowengine.SubmitInput{
		Action: flowengine.ActionSubmit,
		Fields: map[string]any{
			"x-auth-methods#password": "correct-horse-battery-staple",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "credentials", result.Step.Name)
	if assert.NotNil(t, result.Step.Error) {
		assert.Equal(t, "error.email_required", *result.Step.Error)
	}
	// No error produced the key: the log gets a refusal naming it, with the
	// violations as its cause.
	require.NotNil(t, result.Step.Failure)
	refused, ok := errors.AsType[domain.Error](result.Step.Failure.Cause)
	require.True(t, ok)
	assert.Equal(t, "flow.step_refused", refused.Code)
	assert.Contains(t, refused.Message, "error.email_required")
	var violations domain.FlowFieldValidationErrors
	assert.ErrorAs(t, result.Step.Failure.Cause, &violations)
}

// The passkey-register issue leg collects the step's fields, so an omitted
// required field must halt instead of minting a challenge that only fails
// later at create_user.
func TestFlowStateMachine_Process_PasskeyRegisterOmittedRequiredFieldKeepsStep(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	show := domain.FlowStepCompleteShow
	def := &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-passkey-reg-required",
		UserSchema: defaultSchemaURL,
		Purposes:   map[domain.FlowDefinitionPurpose]string{domain.FlowDefinitionPurposeRegister: "register"},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "register",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: flowengine.ActionPasskeyRegister, Kind: domain.FlowActionKindPasskeyRegister, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.ActionPasskeyRegister: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	// No IssueChallenge expectation: the missing required
	// field must halt before any challenge is minted.

	start, err := w.sm.Start(t.Context(), flowengine.StartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.SessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), served(def), start.State, flowengine.SubmitInput{
		Action:    flowengine.ActionPasskeyRegister,
		PasskeyRP: &flowengine.PasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	assert.Equal(t, "register", result.Step.Name)
	assert.Nil(t, result.Step.Challenge, "no challenge may be issued when a required field is missing")
	if assert.NotNil(t, result.Step.Error) {
		assert.Equal(t, "error.email_required", *result.Step.Error)
	}
}

// nestedProfileSchemaContent pairs with nestedProfileDefinition: a
// required identifier plus an object property whose leaves the flow
// collects by dotted path.
const nestedProfileSchemaContent string = `{
	"$schema": "https://json-schema.org/draft/2020-12/schema",
	"type": "object",
	"x-auth-methods": { "password": { "enabled": true } },
	"required": ["email"],
	"properties": {
		"email": { "type": "string", "format": "email", "x-unique": "team" },
		"address": {
			"type": "object",
			"properties": {
				"street": { "type": "string" },
				"city":   { "type": "string" },
				"geo": {
					"type": "object",
					"properties": {
						"label": { "type": "string" }
					}
				}
			}
		}
	}
}`

func nestedProfileDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-nested-profile",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeRegister: "profile",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "profile",
				Fields: []domain.Field{"email", "address.street"},
				Actions: []domain.FlowStepAction{
					{Name: flowengine.ActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.ActionSubmit: {Target: "confirm"},
				},
			},
			{
				Name:   "confirm",
				Fields: []domain.Field{"address.street", "address.city", "address.geo.label"},
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

func TestFlowStateMachine_CollectsNestedFieldsAsADocument(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := nestedProfileDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, nestedProfileSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att-1", nil)
	// No existing user for the identifier, so registration proceeds.
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil)).
		AnyTimes()

	start, err := w.sm.Start(t.Context(), flowengine.StartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.SessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// A nested leaf renders as an ordinary scalar field named by its path.
	streetField := findFieldByName(start.Step.Fields, "address.street")
	require.NotNil(t, streetField)
	assert.Equal(t, domain.FlowFieldTypeText, streetField.Type)
	assert.False(t, streetField.Required, "leaf under an optional parent is not required")

	res, err := w.sm.Process(t.Context(), served(def), start.State, flowengine.SubmitInput{
		Action: flowengine.ActionSubmit,
		Fields: map[string]any{
			"email":          "alice@example.com",
			"address.street": "Main Street 1",
		},
	})
	require.NoError(t, err)

	// The collected document keeps the shape the user schema validates,
	// so it can be handed to create_user as-is.
	address, ok := res.State.CollectedData.UserData["address"].(map[string]any)
	require.True(t, ok, "dotted fields must merge into a nested object")
	assert.Equal(t, "Main Street 1", address["street"])
	assert.Equal(t, "alice@example.com", res.State.CollectedData.UserData["email"])

	// A later step collecting the same leaf pre-fills it from the nested
	// document rather than retyping.
	require.Equal(t, "confirm", res.Step.Name)
	confirmStreet := findFieldByName(res.Step.Fields, "address.street")
	require.NotNil(t, confirmStreet)
	require.NotNil(t, confirmStreet.Value, "nested leaf must prefill from collected data")
	assert.Equal(t, "Main Street 1", *confirmStreet.Value)

	// A second step writing different leaves of the same object merges into
	// the map already in state instead of replacing it, and a leaf more than
	// one level down builds the intermediate objects it descends through.
	final, err := w.sm.Process(t.Context(), served(def), res.State, flowengine.SubmitInput{
		Action: flowengine.ActionSubmit,
		Fields: map[string]any{
			"address.street":    "Main Street 1",
			"address.city":      "Zurich",
			"address.geo.label": "downtown",
		},
	})
	require.NoError(t, err)

	assert.Equal(t, map[string]any{
		"email": "alice@example.com",
		"address": map[string]any{
			"street": "Main Street 1",
			"city":   "Zurich",
			"geo":    map[string]any{"label": "downtown"},
		},
	}, final.State.CollectedData.UserData)
}

// walkToSetPassword starts the multi-step sign-up and submits the profile
// step, which leads to the step that sets the password.
func walkToSetPassword(t *testing.T, w *flowTestWorld) (*domain.FlowDefinition, flowengine.StepResult, error) {
	t.Helper()
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_01TEST", nil)
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
	result, err := w.sm.Process(t.Context(), served(def), start.State, flowengine.SubmitInput{
		Action: flowengine.ActionSubmit,
		Fields: map[string]any{"email": "newcomer@example.com"},
	})
	return def, result, err
}

// A step that sets a password shows the project's policy bounds and refuses
// a candidate below them on the step itself, before the step that creates
// the user.
func TestFlowStateMachine_NewPasswordStepCarriesThePolicyBounds(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	w.passwords.minLength, w.passwords.maxLength = 12, 32

	def, result, err := walkToSetPassword(t, w)
	require.NoError(t, err)
	require.Equal(t, "set-password", result.Step.Name)
	require.Len(t, result.Step.Fields, 1)
	assert.Equal(t, &domain.FlowFieldValidation{MinLength: 12, MaxLength: 32}, result.Step.Fields[0].Validation)
	assert.Equal(t, 1, w.passwords.calls, "rendering the step reads the policy once")

	refused, err := w.sm.Process(t.Context(), served(def), result.State, flowengine.SubmitInput{
		Action: flowengine.ActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "ninechars"},
	})
	require.NoError(t, err)
	require.Equal(t, "set-password", refused.Step.Name)
	require.NotNil(t, refused.Step.Error)
	assert.Equal(t, "error.x-auth-methods#password_min_length", *refused.Step.Error)
}

// Without a policy a new password has no minimum, and the cap is its maximum.
func TestFlowStateMachine_NewPasswordStepWithoutPolicy(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	_, result, err := walkToSetPassword(t, w)
	require.NoError(t, err)
	require.Len(t, result.Step.Fields, 1)
	assert.Equal(t, &domain.FlowFieldValidation{MaxLength: domain.MaxPasswordLength}, result.Step.Fields[0].Validation)
}

// A policy that cannot be read fails the step, as the gate fails the write.
func TestFlowStateMachine_NewPasswordStepFailsClosed(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	w.passwords.err = errors.New("storage down")

	_, _, err := walkToSetPassword(t, w)
	require.ErrorIs(t, err, w.passwords.err)
}
