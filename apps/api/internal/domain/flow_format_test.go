package domain_test

import (
	"testing"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
)

const flowFormatSchema = `{
	"$schema": "https://json-schema.org/draft/2020-12/schema",
	"type": "object",
	"x-auth-methods": { "password": { "enabled": true }, "passkey": { "enabled": true } },
	"x-identifier": "employee",
	"required": ["employee"],
	"properties": {
		"employee": { "type": "string", "format": "uuid", "x-unique": "project" },
		"homepage": { "type": "string", "format": "uri" },
		"seen":     { "type": "string", "format": "date-time" }
	}
}`

const (
	legacyIdentifier = "legacy-id"
	uuidIdentifier   = "019a4a6e-7c21-7d3e-9f10-2b6c1d5e8a90"
)

// flowFormatDefinition asks for the identifier first, whatever the purpose, and
// then for what the given purpose continues with.
func flowFormatDefinition(purpose domain.FlowDefinitionPurpose) *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-format",
		UserSchema: defaultSchemaURL,
		Purposes:   map[domain.FlowDefinitionPurpose]string{purpose: "identify"},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identify",
				Fields: []domain.Field{"employee"},
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit:                     {Target: "next"},
					domain.FlowImplicitOutcomeUserNotFound:      {Target: "not_found"},
					domain.FlowImplicitOutcomeUserAlreadyExists: {Target: "existing"},
				},
			},
			{Name: "next", Complete: &show},
			{Name: "existing", Complete: &show},
			{Name: "not_found", Complete: &show},
		},
	}
}

func startFormatFlow(t *testing.T, w *flowTestWorld, def *domain.FlowDefinition, purpose domain.FlowDefinitionPurpose) *domain.FlowState {
	t.Helper()
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, flowFormatSchema), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       purpose,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	return start.State
}

// An identifier failing its format stays on the step, with no lookup, whatever
// the purpose.
func TestFlowStateMachine_Process_IdentifierFailingItsFormat(t *testing.T) {
	t.Parallel()
	for _, purpose := range []domain.FlowDefinitionPurpose{
		domain.FlowDefinitionPurposeLogin,
		domain.FlowDefinitionPurposeRecovery,
		domain.FlowDefinitionPurposeRegister,
	} {
		t.Run(string(purpose), func(t *testing.T) {
			t.Parallel()
			w := newFlowTestWorld(t)
			def := flowFormatDefinition(purpose)
			state := startFormatFlow(t, w, def, purpose)

			result, err := w.sm.Process(t.Context(), def, state, domain.FlowSubmitInput{
				Action: domain.FlowActionSubmit,
				Fields: map[string]any{"employee": legacyIdentifier},
			})
			require.NoError(t, err)
			require.NotNil(t, result.Step)
			assert.Equal(t, "identify", result.Step.Name)
			if assert.NotNil(t, result.Step.Error) {
				assert.Equal(t, "error.employee_invalid", *result.Step.Error)
			}
			assert.NotContains(t, result.State.CollectedData.UserData, "employee")
		})
	}
}

// The SSO collection step creates its user from what it collected and looks
// nothing up, so its identifier is held to the format as any new value is.
func TestFlowStateMachine_Process_SSOCollectionHoldsIdentifierToItsFormat(t *testing.T) {
	t.Parallel()
	w, def, state := submittableCollectionStepWorld(t)
	claims, verified := completeClaims()
	verified["email"] = false
	w.expectCollected(unlinkedParked(claims, verified), nil).AnyTimes()

	result, err := w.sm.Process(t.Context(), def, state, collectionSubmit(func(fields map[string]any) {
		fields["email"] = "not-an-email"
	}))
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	assert.Equal(t, "sso-register", result.Step.Name)
	if assert.NotNil(t, result.Step.Error) {
		assert.Equal(t, "error.email_invalid", *result.Step.Error)
	}
}

// A blank optional field with a format is an unset attribute: a user write
// refuses "" for it, possibly on a later step with no such field to correct.
func TestFlowStateMachine_Process_BlankOptionalFormattedField(t *testing.T) {
	t.Parallel()
	const purpose = domain.FlowDefinitionPurposeRegister
	build := func(t *testing.T) (*flowTestWorld, *domain.FlowDefinition, *domain.FlowState) {
		t.Helper()
		w := newFlowTestWorld(t)
		def := flowFormatDefinition(purpose)
		def.Steps[0].Fields = []domain.Field{"employee", "homepage", "seen"}
		state := startFormatFlow(t, w, def, purpose)
		w.authAttemptService.EXPECT().
			SubmitIdentifier(gomock.Any(), identifiedBy("attempt-1", "employee", uuidIdentifier)).
			Return("", domain.ErrAuthAttemptProofRejected(nil)).
			AnyTimes()
		w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Return(domain.FlowHandoffOutput{}, nil).AnyTimes()
		return w, def, state
	}

	t.Run("is not collected", func(t *testing.T) {
		t.Parallel()
		w, def, state := build(t)
		state.CollectedData.UserData = map[string]any{"homepage": "https://stale.example.com"}
		result, err := w.sm.Process(t.Context(), def, state, domain.FlowSubmitInput{
			Action: domain.FlowActionSubmit,
			Fields: map[string]any{"employee": uuidIdentifier, "homepage": "", "seen": ""},
		})
		require.NoError(t, err)
		assert.Equal(t, "next", result.State.CurrentStep)
		assert.Equal(t, map[string]any{"employee": uuidIdentifier}, result.State.CollectedData.UserData)
		_, err = domain.NewCreateUser(domain.CreateUserParams{
			ProjectID:  testProjectID,
			ID:         "user_1",
			SchemaURL:  defaultSchemaURL,
			Schema:     []byte(flowFormatSchema),
			Attributes: result.State.CollectedData.UserData,
		})
		require.NoError(t, err, "what the flow collected must pass the user write")
	})

	t.Run("a filled one is held to the format on its own step", func(t *testing.T) {
		t.Parallel()
		w, def, state := build(t)
		result, err := w.sm.Process(t.Context(), def, state, domain.FlowSubmitInput{
			Action: domain.FlowActionSubmit,
			Fields: map[string]any{"employee": uuidIdentifier, "homepage": "no scheme"},
		})
		require.NoError(t, err)
		require.NotNil(t, result.Step)
		assert.Equal(t, "identify", result.Step.Name)
		if assert.NotNil(t, result.Step.Error) {
			assert.Equal(t, "error.homepage_invalid", *result.Step.Error)
		}
	})
}

// A `date-time` has its own input kind: a date input submits `YYYY-MM-DD`, which
// the format refuses.
func TestSchemaFieldResolver_DateTimeHasItsOwnType(t *testing.T) {
	t.Parallel()
	resolver := domain.NewSchemaFieldResolver()
	schema := mustUnmarshal[jsonschema.Schema](t, flowFormatSchema)
	fields, err := resolver.Resolve(schema, "step", []domain.Field{"seen"})
	require.NoError(t, err)
	require.Len(t, fields.Fields, 1)
	assert.Equal(t, domain.FlowFieldTypeDateTime, fields.Fields[0].Type)
	assert.Equal(t, "date-time", fields.Fields[0].Validation.Format)
	require.NoError(t, resolver.Validate(fields, map[string]any{"seen": "2026-11-03T12:00:00Z"}))
	// What the login form submits: toISOString, with milliseconds.
	require.NoError(t, resolver.Validate(fields, map[string]any{"seen": "2026-11-03T12:00:00.000Z"}))
	require.Error(t, resolver.Validate(fields, map[string]any{"seen": "2026-11-03"}))
}
