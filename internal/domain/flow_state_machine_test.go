package domain_test

import (
	"encoding/json"
	"errors"
	"maps"
	"testing"
	"time"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/muhlemmer/gu"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
)

func containsFieldName(fields []domain.FlowField, name string) bool {
	for _, f := range fields {
		if f.Name == name {
			return true
		}
	}
	return false
}

// attemptFor matches the input a rotated auth attempt is started with. The
// session id is the load-bearing part: exchange upgrades that session in
// place, so an attempt started without it would strand the sign-in.
func attemptFor(projectID, sessionID string) gomock.Matcher {
	return gomock.Cond(func(in domain.FlowCreateAttemptInput) bool {
		if in.ProjectID != projectID {
			return false
		}
		return in.SessionID != nil && *in.SessionID == sessionID
	})
}

// identifiedBy matches an identifier submission against the attempt it lands
// on and the value it carries, so a test pinning rotation cannot pass on a
// call that went to the wrong attempt.
func identifiedBy(attemptID, attribute, value string) gomock.Matcher {
	return gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
		return in.AttemptID == attemptID && in.AttributeName == attribute && in.Value == value
	})
}

func findAction(actions []domain.FlowAction, name string) (domain.FlowAction, bool) {
	for _, a := range actions {
		if a.Name == name {
			return a, true
		}
	}
	return domain.FlowAction{}, false
}

// flowTestWorld is the wiring a flow test exercises: resolver +
// registry + handlers + state machine, sharing the fakes the test
// inspects after a run.
type flowTestWorld struct {
	mock               *gomock.Controller
	hasher             *cryptomock.MockHasher
	authAttemptService *domainmock.MockFlowAuthAttemptService
	schemaResolver     *domainmock.MockSchemaResolver
	createUser         *domainmock.MockFlowOnSuccessHandler
	ssoProviders       *domainmock.MockFlowSSOProviderResolver
	ssoIdentities      *domainmock.MockFlowSSOIdentityService
	ssoRedirects       *domainmock.MockFlowSSORedirectIssuer
	sm                 *domain.FlowStateMachineRuntime
}

func newFlowTestWorld(t *testing.T) *flowTestWorld {
	t.Helper()
	mock := gomock.NewController(t)

	hasher := cryptomock.NewMockHasher(mock)
	hasher.EXPECT().
		Hash(gomock.Any()).
		DoAndReturn(func(s string) (string, error) { return "hashed:" + s, nil }).
		AnyTimes()

	schemaResolver := domainmock.NewMockSchemaResolver(mock)
	schemaStore := domainmock.NewMockJSONSchemaStore(mock)
	authAttemptService := domainmock.NewMockFlowAuthAttemptService(mock)
	createUser := domainmock.NewMockFlowOnSuccessHandler(mock)
	ssoProviders := domainmock.NewMockFlowSSOProviderResolver(mock)
	ssoIdentities := domainmock.NewMockFlowSSOIdentityService(mock)
	ssoRedirects := domainmock.NewMockFlowSSORedirectIssuer(mock)

	resolver := domain.NewSchemaFieldResolver()

	now := func() time.Time { return time.Unix(1700000000, 0).UTC() }

	sm := domain.NewFlowStateMachine(
		schemaResolver,
		schemaStore,
		resolver,
		createUser,
		authAttemptService,
		ssoProviders,
		ssoIdentities,
		ssoRedirects,
		now,
	)

	return &flowTestWorld{
		mock:               mock,
		hasher:             hasher,
		schemaResolver:     schemaResolver,
		authAttemptService: authAttemptService,
		createUser:         createUser,
		ssoProviders:       ssoProviders,
		ssoIdentities:      ssoIdentities,
		ssoRedirects:       ssoRedirects,
		sm:                 sm,
	}
}

// loginDefinition builds a single-step login flow: a `credentials`
// step with email (identifier) + password, no on_success, transitioning
// to the `done` terminal on `submit` and to `not_found` on
// `user_not_found`.
func loginDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-login",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "credentials",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "credentials",
				Fields: []domain.Field{"email", "x-auth-methods#password"},
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit:                {Target: "done"},
					domain.FlowImplicitOutcomeUserNotFound: {Target: "not_found"},
				},
			},
			{
				Name:     "done",
				Complete: &show,
			},
			{
				Name:     "not_found",
				Complete: &show,
			},
		},
	}
}

// signupDefinition builds a single-step signup flow: a `credentials`
// step with email+password, on_success=create_user, transitioning to
// the `done` terminal on `submit`.
func signupDefinition() *domain.FlowDefinition {
	createUser := domain.FlowOnSuccessCreateUser
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-signup",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeRegister: "credentials",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:      "credentials",
				Fields:    []domain.Field{"email", "x-auth-methods#password"},
				OnSuccess: &createUser,
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "done"},
				},
			},
			{
				Name:     "done",
				Complete: &show,
			},
		},
	}
}

func TestFlowStateMachine_Start_RendersInitialStep(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := signupDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil)

	w.authAttemptService.EXPECT().
		Start(gomock.Any(), gomock.Cond(func(in domain.FlowCreateAttemptInput) bool {
			return in.ProjectID == testProject && in.SessionID != nil && *in.SessionID == "sess-1"
		})).
		Return("att_01TEST", nil).
		Times(1)

	result, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "credentials", result.Step.Name)
	require.Equal(t, "credentials", result.State.CurrentStep)
	assert.Equal(t, testProjectID, result.State.ProjectID)
	assert.Equal(t, defaultSchemaURL, result.State.UserSchemaURL)
	assert.True(t, containsFieldName(result.Step.Fields, "email"))
	act, ok := findAction(result.Step.Actions, domain.FlowActionSubmit)
	assert.True(t, ok)
	assert.True(t, act.Primary)

	assert.Equal(t, "att_01TEST", result.State.AuthAttemptID)
}

func TestFlowStateMachine_Process_RegistrationHappyPath(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := signupDefinition()

	const userID = "user_01TEST"
	const handoffToken = "handoff_01TEST"
	const email = "alice@example.com"
	const password = "correct-horse-battery-staple"

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)
	w.createUser.EXPECT().
		Handle(gomock.Any(), gomock.Cond(func(in domain.FlowOnSuccessInput) bool {
			return in.State.CollectedData.UserData["email"] == email &&
				in.State.CollectedData.AuthMethods.Password == password
		})).
		Return(domain.FlowOnSuccessResult{UserID: userID}, nil)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Any()).
		Return(domain.FlowHandoffOutput{
			Token:     handoffToken,
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		}, nil).
		Times(1)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return in.Value == email
		})).
		Return("", domain.ErrAuthAttemptProofRejected(nil)).
		Times(1)
	// Register mode dispatches identifier (the email is x-unique, so it
	// always routes through auth-attempt to emit user_already_exists when
	// the name is taken). It must not dispatch password — create_user
	// establishes the credential per its manifest.
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Times(0)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":                   email,
			"x-auth-methods#password": password,
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "done", result.Step.Name)
	if assert.NotNil(t, result.Step.Complete) {
		assert.Equal(t, domain.FlowStepCompleteShow, *result.Step.Complete)
	}

	// create_user pins the user ID and registers them on the attempt so the
	// terminal step can issue a handoff token and auto-sign-in the new user.
	assert.Equal(t, userID, result.State.CollectedData.UserID)
	assert.Equal(t, handoffToken, result.HandoffToken)
}

func TestFlowStateMachine_Process_LoginHappyPath(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	const email = "alice@example.com"
	const attemptID = "att_01TEST"
	const userID = "user_alice"
	const handoffToken = "handoff_01TEST"

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return(attemptID, nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return assert.Equal(t, attemptID, in.AttemptID) &&
				assert.Equal(t, "email", in.AttributeName) &&
				assert.Equal(t, email, in.Value)
		})).
		Return(userID, nil).
		Times(1)
	w.authAttemptService.EXPECT().
		SubmitPassword(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitPasswordInput) bool {
			return in.AttemptID == attemptID
		})).
		Times(1)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Cond(func(in domain.FlowHandoffInput) bool {
			return in.AttemptID == attemptID
		})).
		Return(domain.FlowHandoffOutput{
			Token:     handoffToken,
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		}, nil).
		Times(1)

	def := loginDefinition()

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":                   email,
			"x-auth-methods#password": "correct-horse-battery-staple",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "done", result.Step.Name)

	assert.Equal(t, userID, result.State.CollectedData.UserID)

	assert.Equal(t, handoffToken, result.HandoffToken)
	assert.Equal(t, time.Unix(1700000060, 0).UTC(), result.HandoffTokenExpiresAt)
}

func TestFlowStateMachine_Process_LoginUserNotFound(t *testing.T) {
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
	// password must not be submitted when identifier is unknown
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Times(0)
	// handoff must not run for an informational terminal reached without an identity
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":                   "ghost@example.com",
			"x-auth-methods#password": "irrelevant",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "not_found", result.Step.Name)

	assert.Empty(t, result.HandoffToken, "informational terminal must not surface a handoff token")
}

func TestFlowStateMachine_Process_LoginInvalidPassword(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	const email = "alice@example.com"
	const userID = "user_alice"

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return(userID, nil).
		Times(1)
	w.authAttemptService.EXPECT().
		SubmitPassword(gomock.Any(), gomock.Any()).
		Return(domain.ErrAuthAttemptProofRejected(nil))

	def := loginDefinition()

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":                   email,
			"x-auth-methods#password": "wrong-password",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "credentials", result.Step.Name)
	require.NotNil(t, result.Step.Error)
	assert.Equal(t, domain.FlowStepErrorInvalidCredentials, *result.Step.Error)
}

// A collision on a step that declares create_user never runs the mutation,
// so the password step after it must verify the existing user's password.
func TestFlowStateMachine_Process_RegisterCollisionVerifiesPassword(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := signupDefinition()
	def.Steps[0].Transitions[domain.FlowImplicitOutcomeUserAlreadyExists] = domain.FlowStepTransition{Target: "password"}
	def.Steps = append(def.Steps, domain.FlowDefinitionStep{
		Name:   "password",
		Fields: []domain.Field{"x-auth-methods#password"},
		Actions: []domain.FlowStepAction{
			{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
		},
		Transitions: map[string]domain.FlowStepTransition{
			domain.FlowActionSubmit: {Target: "done"},
		},
	})

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), identifiedBy("attempt-1", "email", "alice@example.com")).
		Return("user_alice", nil)
	w.authAttemptService.EXPECT().
		SubmitPassword(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitPasswordInput) bool {
			return in.AttemptID == "attempt-1" && in.Plain == "wrong-password"
		})).
		Return(domain.ErrAuthAttemptProofRejected(nil))
	w.createUser.EXPECT().Handle(gomock.Any(), gomock.Any()).Times(0)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	collided, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":                   "alice@example.com",
			"x-auth-methods#password": "attacker-chosen",
		},
	})
	require.NoError(t, err)
	require.Equal(t, "password", collided.State.CurrentStep)
	require.Equal(t, domain.FlowDefinitionPurposeLogin, collided.State.CurrentPurpose)

	result, err := w.sm.Process(t.Context(), def, collided.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "wrong-password"},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "password", result.Step.Name)
	require.NotNil(t, result.Step.Error)
	assert.Equal(t, domain.FlowStepErrorInvalidCredentials, *result.Step.Error)
	assert.Empty(t, result.HandoffToken)
}

func TestFlowStateMachine_Process_FieldValidationErrorKeepsStep(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := signupDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// The submit action collects the step's fields, so the required email
	// the client left out entirely must surface as a per-field error rather
	// than passing through to fail late at create_user.
	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
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
					{Name: domain.FlowActionPasskeyRegister, Kind: domain.FlowActionKindPasskeyRegister, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionPasskeyRegister: {Target: "done"},
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
	// No IssuePasskeyRegistrationChallenge expectation: the missing required
	// field must halt before any challenge is minted.

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskeyRegister,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	assert.Equal(t, "register", result.Step.Name)
	assert.Nil(t, result.Step.Challenge, "no challenge may be issued when a required field is missing")
	if assert.NotNil(t, result.Step.Error) {
		assert.Equal(t, "error.email_required", *result.Step.Error)
	}
}

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
		Return(domain.FlowOnSuccessResult{UserID: "user-id1"}, nil)

	def := signupDefinition()
	// Mutate the submit transition to point at a non-existent step.
	def.Steps[0].Transitions[domain.FlowActionSubmit] = domain.FlowStepTransition{Target: "nope"}

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	_, err = w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":                   "alice@example.com",
			"x-auth-methods#password": "correct-horse-battery-staple",
		},
	})
	require.ErrorIs(t, err, domain.ErrFlowIntegrity())
}

// create_user_with_sso is accepted by the contract so an SSO flow can be
// authored and stored, but no handler is wired yet. A step that reaches it
// must fail loudly rather than advance as though a user had been created.
func TestFlowStateMachine_Process_CreateUserWithSsoNotWired(t *testing.T) {
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
	// The create_user handler must not run for a different mutation.
	w.createUser.EXPECT().Handle(gomock.Any(), gomock.Any()).Times(0)
	// The start render and the submit look for a parked identity to prefill.
	w.ssoIdentities.EXPECT().
		LoadCollected(gomock.Any(), domain.FlowSSOLoadInput{ProjectID: testProjectID, AttemptID: "attempt-1", UserSchemaURL: defaultSchemaURL}).
		Return(nil, nil).
		Times(2)

	withSso := domain.FlowOnSuccessCreateUserWithSso
	def := signupDefinition()
	def.Steps[0].OnSuccess = &withSso

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	_, err = w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":                   "alice@example.com",
			"x-auth-methods#password": "correct-horse-battery-staple",
		},
	})
	require.ErrorIs(t, err, domain.ErrFlowIntegrity())
	assert.Contains(t, err.Error(), "on_success create_user_with_sso not wired")
}

func TestFlowStateMachine_Process_InvalidActionRejected(t *testing.T) {
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
		Return(domain.FlowOnSuccessResult{UserID: "user-id1"}, nil)

	def := signupDefinition()

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	_, err = w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: "not_declared",
		Fields: map[string]any{
			"email":                   "alice@example.com",
			"x-auth-methods#password": "correct-horse-battery-staple",
		},
	})
	require.ErrorIs(t, err, domain.ErrFlowInvalidAction())
}

// startSSOStepFlow starts a flow on the sso step and returns its state.
// The one render expectation it sets is consumed by Start; a test that
// re-renders adds its own.
func startSSOStepFlow(t *testing.T, w *flowTestWorld, def *domain.FlowDefinition) *domain.FlowState {
	t.Helper()
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.ssoProviders.EXPECT().
		Resolve(gomock.Any(), testProjectID, "credentials", []string{"google", "github"}).
		Return([]domain.FlowSSOProvider{{ID: "google", Name: "Google"}, {ID: "github", Name: "GitHub"}}, nil)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	return start.State
}

var ssoSubmitReturn = &domain.FlowSSOReturn{
	RedirectURI:  "https://auth.example.com/__nextgen/idp/callback",
	ReturnTarget: "https://auth.example.com/login?flow=flow-1",
}

func TestFlowStateMachine_Process_SSO_EmitsRedirectStep(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := ssoStepDefinition()
	state := startSSOStepFlow(t, w, def)
	// Picking a provider abandons a ceremony the step had pending.
	state.PendingChallenge = &domain.FlowPendingChallenge{ID: "ch-1", Method: domain.FlowChallengeMethodPasskey}

	w.ssoRedirects.EXPECT().
		Issue(gomock.Any(), domain.FlowIssueSSORedirectInput{
			ProjectID:     testProjectID,
			AttemptID:     "attempt-1",
			ProviderSlug:  "google",
			FlowSSOReturn: *ssoSubmitReturn,
		}).
		Return(domain.FlowSSORedirectOutput{
			RedirectURL:  "https://accounts.google.com/o/oauth2/v2/auth?state=abc",
			BindingNonce: "nonce-1",
		}, nil)

	result, err := w.sm.Process(t.Context(), def, state, domain.FlowSubmitInput{
		Action:      domain.FlowActionSSO,
		SSOProvider: &domain.FlowSSOProviderRef{ID: "google"},
		SSOReturn:   ssoSubmitReturn,
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	assert.Equal(t, domain.FlowStepNameSSORedirect, result.Step.Name)
	assert.Equal(t, "sso.redirect.title", result.Step.Texts.TitleKey)
	require.NotNil(t, result.Step.RedirectURL)
	assert.Equal(t, "https://accounts.google.com/o/oauth2/v2/auth?state=abc", *result.Step.RedirectURL)
	assert.Empty(t, result.Step.Fields, "the redirect step collects nothing")
	assert.Empty(t, result.Step.Actions)
	assert.Equal(t, "nonce-1", result.SSOBindingNonce)
	assert.Equal(t, "credentials", result.State.CurrentStep, "the flow waits on the step the provider was picked from")
	assert.Equal(t, time.Unix(1700000000, 0).UTC(), result.State.IssuedAt, "the re-sealed cookie starts a fresh window for the external leg")
	assert.Nil(t, result.State.PendingChallenge, "the abandoned ceremony is dropped")
	assert.Nil(t, result.Step.Challenge, "a cleared challenge is not rendered")
}

func TestFlowStateMachine_Process_SSO_InvalidSubmissions(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		in   domain.FlowSubmitInput
	}{
		{
			name: "provider not offered on the step",
			in: domain.FlowSubmitInput{
				Action:      domain.FlowActionSSO,
				SSOProvider: &domain.FlowSSOProviderRef{ID: "okta"},
				SSOReturn:   ssoSubmitReturn,
			},
		},
		{
			name: "sso action without a provider",
			in: domain.FlowSubmitInput{
				Action:    domain.FlowActionSSO,
				SSOReturn: ssoSubmitReturn,
			},
		},
		{
			name: "provider on another action",
			in: domain.FlowSubmitInput{
				Action:      domain.FlowActionSubmit,
				SSOProvider: &domain.FlowSSOProviderRef{ID: "google"},
				SSOReturn:   ssoSubmitReturn,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			w := newFlowTestWorld(t)
			def := ssoStepDefinition()
			state := startSSOStepFlow(t, w, def)

			_, err := w.sm.Process(t.Context(), def, state, tt.in)
			require.ErrorIs(t, err, domain.ErrFlowInvalidAction())
		})
	}
}

func TestFlowStateMachine_Process_SSO_ReturnParamsMissing(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := ssoStepDefinition()
	state := startSSOStepFlow(t, w, def)

	_, err := w.sm.Process(t.Context(), def, state, domain.FlowSubmitInput{
		Action:      domain.FlowActionSSO,
		SSOProvider: &domain.FlowSSOProviderRef{ID: "google"},
	})
	require.ErrorIs(t, err, domain.ErrFlowIntegrity())
}

func TestFlowStateMachine_Process_SSO_ProviderUnavailableReRendersStep(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := ssoStepDefinition()
	state := startSSOStepFlow(t, w, def)
	// The re-render after a provider outage drops a pending ceremony too.
	state.PendingChallenge = &domain.FlowPendingChallenge{ID: "ch-1", Method: domain.FlowChallengeMethodPasskey}
	w.ssoRedirects.EXPECT().Issue(gomock.Any(), gomock.Any()).
		Return(domain.FlowSSORedirectOutput{}, domain.ErrFlowSSOUnavailable(errors.New("discovery timed out")))
	w.ssoProviders.EXPECT().
		Resolve(gomock.Any(), testProjectID, "credentials", []string{"google", "github"}).
		Return([]domain.FlowSSOProvider{{ID: "google", Name: "Google"}, {ID: "github", Name: "GitHub"}}, nil)

	result, err := w.sm.Process(t.Context(), def, state, domain.FlowSubmitInput{
		Action:      domain.FlowActionSSO,
		SSOProvider: &domain.FlowSSOProviderRef{ID: "google"},
		SSOReturn:   ssoSubmitReturn,
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	assert.Equal(t, "credentials", result.Step.Name)
	require.NotNil(t, result.Step.Error)
	assert.Equal(t, domain.FlowStepErrorSSOUnavailable, *result.Step.Error)
	assert.Len(t, result.Step.SSOProviders, 2, "the other providers stay on offer")
	assert.Nil(t, result.Step.RedirectURL)
	assert.Empty(t, result.SSOBindingNonce)
	assert.Nil(t, result.State.PendingChallenge, "the abandoned ceremony is dropped")
	assert.Nil(t, result.Step.Challenge, "a cleared challenge is not rendered")
}

func TestFlowStateMachine_Process_SSO_IssueErrors(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		issue   error
		wantErr error
	}{
		{
			// A slug the render dropped is one the client was never offered,
			// so a submission naming it is an invalid action rather than a
			// provider outage.
			name:    "connection gone is an invalid action",
			issue:   domain.ErrIDPConnectionNotFound(),
			wantErr: domain.ErrFlowInvalidAction(),
		},
		{
			name:    "attempt error passes through",
			issue:   domain.ErrAuthAttemptAlreadyHandedOff(),
			wantErr: domain.ErrAuthAttemptAlreadyHandedOff(),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			w := newFlowTestWorld(t)
			def := ssoStepDefinition()
			state := startSSOStepFlow(t, w, def)
			w.ssoRedirects.EXPECT().Issue(gomock.Any(), gomock.Any()).Return(domain.FlowSSORedirectOutput{}, tt.issue)

			_, err := w.sm.Process(t.Context(), def, state, domain.FlowSubmitInput{
				Action:      domain.FlowActionSSO,
				SSOProvider: &domain.FlowSSOProviderRef{ID: "google"},
				SSOReturn:   ssoSubmitReturn,
			})
			require.ErrorIs(t, err, tt.wantErr)
		})
	}
}

// ssoStepDefinition offers two providers on the signup step, routed to
// done on sso_authenticated as the validator requires of a step with sso_providers.
func ssoStepDefinition() *domain.FlowDefinition {
	def := signupDefinition()
	def.Steps[0].SSOProviders = []string{"google", "github"}
	def.Steps[0].Transitions["sso_authenticated"] = domain.FlowStepTransition{Target: "done"}
	return def
}

func TestFlowStateMachine_Start_RendersSSOProvidersInStepOrder(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := ssoStepDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil)
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	google := domain.FlowSSOProvider{ID: "google", Name: "Google", Template: "google"}
	github := domain.FlowSSOProvider{ID: "github", Name: "GitHub", Template: "github"}
	w.ssoProviders.EXPECT().
		Resolve(gomock.Any(), testProjectID, "credentials", []string{"google", "github"}).
		Return([]domain.FlowSSOProvider{google, github}, nil)

	result, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	assert.Equal(t, []domain.FlowSSOProvider{google, github}, result.Step.SSOProviders)
	assert.True(t, containsFieldName(result.Step.Fields, "email"), "the step's inputs render alongside the providers")
}

// Providers are resolved on every render, not once per flow, so an edit to
// a connection's display name shows on the next page load. A validation
// error is the cheapest second render to prove it on.
func TestFlowStateMachine_Process_ReRenderResolvesSSOProvidersAgain(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := ssoStepDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	gomock.InOrder(
		w.ssoProviders.EXPECT().
			Resolve(gomock.Any(), testProjectID, "credentials", []string{"google", "github"}).
			Return([]domain.FlowSSOProvider{{ID: "google", Name: "Google", Template: "google"}}, nil),
		w.ssoProviders.EXPECT().
			Resolve(gomock.Any(), testProjectID, "credentials", []string{"google", "github"}).
			Return([]domain.FlowSSOProvider{{ID: "google", Name: "Google Workspace", Template: "google"}}, nil),
	)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	require.Equal(t, "credentials", result.Step.Name)
	require.NotNil(t, result.Step.Error)
	assert.Equal(t, []domain.FlowSSOProvider{{ID: "google", Name: "Google Workspace", Template: "google"}}, result.Step.SSOProviders)
}

func TestFlowStateMachine_Start_SSOProviderResolverErrorFailsRender(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := ssoStepDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil)
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.ssoProviders.EXPECT().
		Resolve(gomock.Any(), testProjectID, "credentials", []string{"google", "github"}).
		Return(nil, errors.New("connection store unavailable"))

	_, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.ErrorContains(t, err, "connection store unavailable")
}

// passkeyLoginDefinition builds a single-step passkey login: an
// `authenticate` step offering the `passkey` action, transitioning to the
// `done` terminal once the assertion verifies.
func passkeyLoginDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-passkey",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "authenticate",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "authenticate",
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionPasskey, Kind: domain.FlowActionKindPasskey, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionPasskey: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

func TestFlowStateMachine_Process_PasskeyIssueThenVerify(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	const userID = "user_alice"
	const challengeID = "ch-1"
	const rpid = "example.com"
	const proof = `{"id":"x"}`
	const publicKey = `{"publicKey":{}}`
	const handoffToken = "handoff_01TEST"

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		IssuePasskeyChallenge(gomock.Any(), gomock.Cond(func(in domain.FlowIssuePasskeyChallengeInput) bool {
			return in.RPID == rpid
		})).
		Return(domain.FlowPasskeyChallengeOutput{ChallengeID: challengeID, Options: []byte(publicKey)}, nil).
		Times(1)
	w.authAttemptService.EXPECT().
		SubmitPasskey(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitPasskeyInput) bool {
			return in.ChallengeID == challengeID && string(in.Assertion) == proof
		})).
		Return(userID, nil).
		Times(1)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Return(domain.FlowHandoffOutput{
		Token:     handoffToken,
		ExpiresAt: time.Unix(1700000060, 0).UTC(),
	}, nil)

	def := passkeyLoginDefinition()

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Issue leg: selecting the passkey action mints a challenge and halts on the
	// same step, surfacing the ceremony options.
	issued, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: rpid, Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.Step.Challenge)
	assert.Equal(t, challengeID, issued.Step.Challenge.ChallengeID)
	assert.Equal(t, domain.FlowChallengeMethodPasskey, issued.Step.Challenge.Method)
	assert.Equal(t, publicKey, string(issued.Step.Challenge.Options))
	require.NotNil(t, issued.State.PendingChallenge)
	assert.Equal(t, "authenticate", issued.State.CurrentStep)

	// Verify leg: the signed assertion clears the challenge and advances.
	verified, err := w.sm.Process(t.Context(), def, issued.State, domain.FlowSubmitInput{
		Action:            domain.FlowActionPasskey,
		ChallengeResponse: &domain.FlowChallengeResponse{ChallengeID: challengeID, Method: "passkey", Proof: []byte(proof)},
	})
	require.NoError(t, err)
	assert.Nil(t, verified.State.PendingChallenge)
	require.NotNil(t, verified.Step.Complete)
	assert.Equal(t, handoffToken, verified.HandoffToken)
	assert.Equal(t, userID, verified.State.CollectedData.UserID)
}

func TestFlowStateMachine_Process_PasskeyProofRejectedKeepsStep(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	const challengeID = "ch-1"

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		IssuePasskeyChallenge(gomock.Any(), gomock.Any()).
		Return(domain.FlowPasskeyChallengeOutput{ChallengeID: challengeID, Options: []byte(`{"publicKey":{}}`)}, nil)
	w.authAttemptService.EXPECT().
		SubmitPasskey(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil))

	def := passkeyLoginDefinition()

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	issued, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	rejected, err := w.sm.Process(t.Context(), def, issued.State, domain.FlowSubmitInput{
		Action:            domain.FlowActionPasskey,
		ChallengeResponse: &domain.FlowChallengeResponse{ChallengeID: challengeID, Proof: []byte(`{}`)},
	})
	require.NoError(t, err)
	require.NotNil(t, rejected.Step.Error)
	assert.Equal(t, domain.FlowStepErrorPasskeyInvalid, *rejected.Step.Error)
	assert.Nil(t, rejected.State.PendingChallenge)
	assert.Equal(t, "authenticate", rejected.State.CurrentStep)
}

// passkeyAbandonDefinition offers both a `passkey` and a generic `submit`
// action on the same step, with separate transition targets. Lets a test
// issue a passkey challenge and then submit `submit` to exercise the
// abandonment path.
func passkeyAbandonDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-passkey-abandon",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "authenticate",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "authenticate",
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionPasskey, Kind: domain.FlowActionKindPasskey, Primary: true},

					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionPasskey: {Target: "done"},
					domain.FlowActionSubmit:  {Target: "fallback"},
				},
			},
			{Name: "done", Complete: &show},
			{Name: "fallback", Complete: &show},
		},
	}
}

// Submitting a non-passkey action while a passkey challenge is pending must
// clear the challenge and route via the submitted action, instead of
// re-emitting the passkey prompt and trapping the user on the ceremony.
func TestFlowStateMachine_Process_PasskeyAbandonedOnDifferentAction(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().
		IssuePasskeyChallenge(gomock.Any(), gomock.Any()).
		Return(domain.FlowPasskeyChallengeOutput{ChallengeID: "ch-1", Options: []byte(`{"publicKey":{}}`)}, nil)
	// no passkey verification should run when no proof was submitted
	w.authAttemptService.EXPECT().SubmitPasskey(gomock.Any(), gomock.Any()).Times(0)

	def := passkeyAbandonDefinition()

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	issued, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	abandoned, err := w.sm.Process(t.Context(), def, issued.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
	})
	require.NoError(t, err)
	assert.Nil(t, abandoned.State.PendingChallenge, "pending challenge must be cleared when the user picks a different action")
	assert.Nil(t, abandoned.Step.Challenge, "the rendered step must not re-attach the abandoned passkey challenge")
	require.NotNil(t, abandoned.Step.Complete, "submit action should advance to the fallback terminal")
}

// passkeyIdentifierLoginDefinition builds a login step that collects the
// identifier on the same step that offers the passkey action — the shape
// the discoverable/non-discoverable passkey UI submits (email + "Login
// with passkey" click).
func passkeyIdentifierLoginDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-passkey-identifier",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "authenticate",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "authenticate",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionPasskey, Kind: domain.FlowActionKindPasskey, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionPasskey:               {Target: "done"},
					domain.FlowImplicitOutcomeUserNotFound: {Target: "not_found"},
				},
			},
			{Name: "done", Complete: &show},
			{Name: "not_found", Complete: &show},
		},
	}
}

// Repro for the "passkey login only works after refresh when two users share
// the browser" bug: after attempt 1 rejects (user1 has no passkey), the
// stored _user_id from attempt 1 must not block re-identifying user2 on
// attempt 2. Otherwise the new challenge is still scoped to user1 and the
// second user can never log in.
func TestFlowStateMachine_Process_PasskeyAfterRejectionRebindsIdentifier(t *testing.T) {
	t.Parallel()

	const attemptID = "attempt-1"
	const publicKey = `{"publicKey":{}}`

	const email1 = "user1@example.com"
	const userID1 = "user_one"
	const challengeID1 = "ch-1"

	const challengeID2 = "ch-2"
	const email2 = "user2@example.com"
	const userID2 = "user_two"

	w := newFlowTestWorld(t)
	def := passkeyIdentifierLoginDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return(attemptID, nil)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()

	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return attemptID == in.AttemptID && in.AttributeName == "email" && email1 == in.Value
		})).
		Return(userID1, nil).
		Times(1)
	w.authAttemptService.EXPECT().
		IssuePasskeyChallenge(gomock.Any(), gomock.Any()).
		Return(domain.FlowPasskeyChallengeOutput{ChallengeID: challengeID1, Options: []byte(publicKey)}, nil)
	w.authAttemptService.EXPECT().
		SubmitPasskey(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitPasskeyInput) bool {
			return in.ChallengeID == challengeID1 && string(in.Assertion) == `{}`
		})).
		Return("", domain.ErrAuthAttemptProofRejected(nil)).
		Times(1)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Attempt 1, issue leg: user1 (password-only) types their email and
	// clicks "Login with passkey". The dispatch loop identifies user1, then
	// processPasskey mints a challenge scoped to user1 (empty allowCredentials
	// since user1 has no passkey).
	issued1, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		Fields:    map[string]any{"email": email1},
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued1.State.PendingChallenge)
	assert.Equal(t, "user_one", issued1.State.CollectedData.UserID)

	// Attempt 1, verify leg: the assertion that comes back doesn't match any
	// credential the attempt is constrained to → server rejects.
	rejected, err := w.sm.Process(t.Context(), def, issued1.State, domain.FlowSubmitInput{
		Action: domain.FlowActionPasskey,
		ChallengeResponse: &domain.FlowChallengeResponse{
			ChallengeID: challengeID1,
			Method:      domain.FlowChallengeMethodPasskey, Proof: []byte(`{}`),
		},
	})
	require.NoError(t, err)
	assert.Equal(t, domain.FlowStepErrorPasskeyInvalid, gu.Value(rejected.Step.Error))
	assert.Nil(t, rejected.State.PendingChallenge, "rejection clears PendingChallenge")

	// Attempt 2, issue leg: the user re-types user2's email (passkey-only)
	// and clicks "Login with passkey" again. user2 must be re-identified so
	// the new challenge is scoped to user2's credentials. Before this fix,
	// the dispatch loop skipped SubmitIdentifier whenever a previous _user_id
	// was stored, leaving the attempt bound to user1.
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return attemptID == in.AttemptID && in.AttributeName == "email" && email2 == in.Value
		})).
		Return(userID2, nil).
		Times(1)
	w.authAttemptService.EXPECT().
		IssuePasskeyChallenge(gomock.Any(), gomock.Any()).
		Return(domain.FlowPasskeyChallengeOutput{ChallengeID: challengeID2, Options: []byte(publicKey)}, nil)

	issued2, err := w.sm.Process(t.Context(), def, rejected.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		Fields:    map[string]any{"email": "user2@example.com"},
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued2.State.PendingChallenge, "attempt 2 must issue a fresh passkey challenge")

	assert.Equal(t, "user_two", issued2.State.CollectedData.UserID,
		"_user_id must be rebound to user_two so the new passkey challenge is scoped to their credentials")
}

// Re-submitting the same identifier resolves to the same user, so the
// in-flight ceremony survives. The dispatch re-runs (the auth-attempt is
// the source of truth for whether the binding should change); the resolved
// user id is the same, so PendingChallenge is preserved.
func TestFlowStateMachine_Process_PasskeyResubmitSameIdentifierKeepsPendingChallenge(t *testing.T) {
	t.Parallel()

	const attemptID = "attempt-1"
	const publicKey = `{"publicKey":{}}`
	const email = "user1@example.com"
	const userID = "user_one"
	const challengeID = "ch-1"

	w := newFlowTestWorld(t)
	def := passkeyIdentifierLoginDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return(attemptID, nil)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return attemptID == in.AttemptID && in.AttributeName == "email" && email == in.Value
		})).
		Return(userID, nil).
		Times(2)
	w.authAttemptService.EXPECT().
		IssuePasskeyChallenge(gomock.Any(), gomock.Any()).
		Return(domain.FlowPasskeyChallengeOutput{ChallengeID: challengeID, Options: []byte(publicKey)}, nil)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	first, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		Fields:    map[string]any{"email": email},
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)

	// Same email re-submitted (e.g. user clicked the passkey action again
	// after dismissing the browser prompt). Same user resolved → ceremony stays.
	second, err := w.sm.Process(t.Context(), def, first.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		Fields:    map[string]any{"email": email},
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, second.State.PendingChallenge, "same user resolved — ceremony survives")
	assert.Equal(t, "user_one", second.State.CollectedData.UserID)
}

// ---- CurrentPurpose + outcome flip ----

func TestFlowStateMachine_Start_InitializesCurrentPurpose(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		purpose domain.FlowDefinitionPurpose
	}{
		{"login", domain.FlowDefinitionPurposeLogin},
		{"register", domain.FlowDefinitionPurposeRegister},
		{"recovery", domain.FlowDefinitionPurposeRecovery},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := newFlowTestWorld(t)
			def := signupDefinition()

			w.schemaResolver.EXPECT().
				Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
				Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
				AnyTimes()
			w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)

			// signupDefinition only declares Register; register the other purposes
			// so Start can resolve an entry step.
			def.Purposes[domain.FlowDefinitionPurposeLogin] = "credentials"
			def.Purposes[domain.FlowDefinitionPurposeRecovery] = "credentials"

			result, err := w.sm.Start(t.Context(), domain.FlowStartInput{
				Definition:    def,
				Purpose:       tc.purpose,
				Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
				UserSchemaURL: defaultSchemaURL,
			})
			require.NoError(t, err)
			assert.Equal(t, tc.purpose, result.State.Purpose)
			assert.Equal(t, tc.purpose, result.State.CurrentPurpose)
		})
	}
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, start.State.CurrentPurpose)

	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRecovery,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
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
					{Name: domain.FlowActionSubmit, Primary: true},
					{Name: domain.FlowActionPasskey},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit:                {Target: "password"},
					domain.FlowActionPasskey:               {Target: "done"},
					domain.FlowImplicitOutcomeUserNotFound: {Target: "register"},
				},
			},
			{
				Name:   "password",
				Fields: []domain.Field{"x-auth-methods#password"},
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "done"},
				},
			},
			{
				Name:   "register",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "done"},
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
		IssuePasskeyChallenge(gomock.Any(), gomock.Any()).
		Times(0)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, start.State.CurrentPurpose)

	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		Fields:    map[string]any{"email": email},
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
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
					{Name: domain.FlowActionSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

// TestFlowStateMachine_FlipTable_OutcomeWithoutTransition_DoesNotFlip
// pins the invariant that CurrentPurpose flips only when a flip outcome
// is actually routed. Dispatch returns user_not_found but the step has
// no transition for it; the engine surfaces a step error and the mode
// must stay at login so the next submit doesn't silently dispatch as
// register.
func TestFlowStateMachine_FlipTable_OutcomeWithoutTransition_DoesNotFlip(t *testing.T) {
	t.Parallel()
	const attemptID = "attempt-1"

	w := newFlowTestWorld(t)
	def := loginNoUserNotFoundDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return(attemptID, nil)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil))

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "ghost@example.com", "x-auth-methods#password": "irrelevant"},
	})
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.State.CurrentStep, "no transition for user_not_found keeps the user on the current step")
	if assert.NotNil(t, result.Step.Error) {
		assert.Equal(t, domain.FlowImplicitOutcomeUserNotFound, *result.Step.Error)
	}
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, result.State.CurrentPurpose,
		"CurrentPurpose must not flip when the routed outcome had no transition wired")
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
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return attemptID == in.AttemptID && in.AttributeName == "email" && email == in.Value
		})).
		Return(userID, nil).
		AnyTimes()
	w.authAttemptService.EXPECT().
		SubmitPassword(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitPasswordInput) bool {
			return attemptID == in.AttemptID && in.Plain == incorrectPassword
		})).
		Return(domain.ErrAuthAttemptProofRejected(nil)).
		Times(1)
	w.authAttemptService.EXPECT().
		SubmitPassword(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitPasswordInput) bool {
			return attemptID == in.AttemptID && in.Plain == correctPassword
		})).
		Return(nil).
		Times(1)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Return(domain.FlowHandoffOutput{
		Token:     handoffToken,
		ExpiresAt: time.Unix(1700000060, 0).UTC(),
	}, nil)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Typo: dispatch returns user_not_found, no transition wired,
	// engine surfaces a step error and the user stays on credentials.
	typo, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": email, "x-auth-methods#password": incorrectPassword},
	})
	require.NoError(t, err)
	require.Equal(t, "credentials", typo.State.CurrentStep)
	require.NotNil(t, typo.Step.Error)
	require.Equal(t, domain.FlowDefinitionPurposeLogin, typo.State.CurrentPurpose,
		"phantom flip on the typo would wedge the retry below")

	// Retry with the correct (known) email: still in login mode, so
	// identifier resolves, password verifies, and the user signs in.
	result, err := w.sm.Process(t.Context(), def, typo.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": email, "x-auth-methods#password": correctPassword},
	})
	require.NoError(t, err)
	assert.Equal(t, "done", result.State.CurrentStep)
	assert.Equal(t, "user_alice", result.State.CollectedData.UserID)
	assert.Equal(t, handoffToken, result.HandoffToken, "handoff issued for completed sign-in")
}

func TestFlowState_JSONRoundTrip_PreservesCurrentPurpose(t *testing.T) {
	t.Parallel()
	state := domain.FlowState{
		ID:        "flow-1",
		ProjectID: "proj-1",
		FlowProgress: domain.FlowProgress{
			DefinitionID:   "def-1",
			Purpose:        domain.FlowDefinitionPurposeLogin,
			CurrentPurpose: domain.FlowDefinitionPurposeRegister,
			CurrentStep:    "credentials",
		},
	}
	payload, err := json.Marshal(state)
	require.NoError(t, err)

	var decoded domain.FlowState
	require.NoError(t, json.Unmarshal(payload, &decoded))
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, decoded.Purpose)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, decoded.CurrentPurpose)
}

func TestFlowState_JSONRoundTrip_PivotPushPopPreservesCurrentPurpose(t *testing.T) {
	t.Parallel()
	parent := domain.FlowProgress{
		DefinitionID:   "def-parent",
		Purpose:        domain.FlowDefinitionPurposeLogin,
		CurrentPurpose: domain.FlowDefinitionPurposeRegister,
		CurrentStep:    "parent-step",
	}
	state := domain.FlowState{
		ID:        "flow-1",
		ProjectID: "proj-1",
		FlowProgress: domain.FlowProgress{
			DefinitionID:   "def-child",
			Purpose:        domain.FlowDefinitionPurposeLogin,
			CurrentPurpose: domain.FlowDefinitionPurposeLogin,
			CurrentStep:    "child-step",
		},
		PivotStack: []domain.FlowProgress{parent},
	}

	payload, err := json.Marshal(state)
	require.NoError(t, err)
	var decoded domain.FlowState
	require.NoError(t, json.Unmarshal(payload, &decoded))

	require.Len(t, decoded.PivotStack, 1)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, decoded.PivotStack[0].CurrentPurpose)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, decoded.CurrentPurpose)
}

// ---- Dispatch worked examples ----

// multiStepSignupDefinition is worked example A.
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
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit:                     {Target: "set-password"},
					domain.FlowImplicitOutcomeUserAlreadyExists: {Target: "done"},
				},
			},
			{
				Name:   "set-password",
				Fields: []domain.Field{"x-auth-methods#password"},
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "create"},
				},
			},
			{
				Name:      "create",
				OnSuccess: &createUser,
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
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit:                     {Target: "signin-password"},
					domain.FlowImplicitOutcomeUserNotFound:      {Target: "register-password"},
					domain.FlowImplicitOutcomeUserAlreadyExists: {Target: "signin-password"},
				},
			},
			{
				Name:   "signin-password",
				Fields: []domain.Field{"x-auth-methods#password"},
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "done"},
				},
			},
			{
				Name:      "register-password",
				Fields:    []domain.Field{"x-auth-methods#password"},
				OnSuccess: &createUser,
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
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit:                {Target: "new-password"},
					domain.FlowImplicitOutcomeUserNotFound: {Target: "done"},
				},
			},
			{
				Name:   "new-password",
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
		Handle(gomock.Any(), gomock.Cond(func(in domain.FlowOnSuccessInput) bool {
			return in.State.CollectedData.UserData["email"] == email
		})).
		Return(domain.FlowOnSuccessResult{UserID: "user-id1"}, nil)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Any()).
		Return(domain.FlowHandoffOutput{
			Token:     "handoff_01TEST",
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		}, nil)
	// register mode never verifies password
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Times(0)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	afterProfile, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	assert.Equal(t, "set-password", afterProfile.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, afterProfile.State.CurrentPurpose)

	afterPassword, err := w.sm.Process(t.Context(), def, afterProfile.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	assert.Equal(t, "create", afterPassword.State.CurrentStep)

	done, err := w.sm.Process(t.Context(), def, afterPassword.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
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
		Return(domain.FlowHandoffOutput{Token: "handoff_01TEST"}, nil)

	def := multiStepSignupDefinition()

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
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
		Handle(gomock.Any(), gomock.Cond(func(in domain.FlowOnSuccessInput) bool {
			return in.State.CollectedData.UserData["email"] == email
		})).
		Return(domain.FlowOnSuccessResult{UserID: "user-id1"}, nil)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Any()).
		Return(domain.FlowHandoffOutput{
			Token:     "handoff_01TEST",
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		}, nil)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	afterIdentify, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	assert.Equal(t, "register-password", afterIdentify.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, afterIdentify.State.CurrentPurpose)

	done, err := w.sm.Process(t.Context(), def, afterIdentify.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
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
		Return(domain.FlowHandoffOutput{Token: "handoff_01TEST"}, nil)

	def := combinedSigninSignupDefinition()

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	afterIdentify, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "alice@example.com"},
	})
	require.NoError(t, err)
	assert.Equal(t, "signin-password", afterIdentify.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, afterIdentify.State.CurrentPurpose)
	assert.Equal(t, "user_alice", afterIdentify.State.CollectedData.UserID,
		"the flip pins the found user on the attempt, so the flow must know it too")

	done, err := w.sm.Process(t.Context(), def, afterIdentify.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
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
		Return(domain.FlowHandoffOutput{
			Token:     "handoff_01TEST",
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		}, nil)

	def := recoveryDefinition()

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRecovery,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	afterIdentify, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "alice@example.com"},
	})
	require.NoError(t, err)
	assert.Equal(t, "new-password", afterIdentify.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRecovery, afterIdentify.State.CurrentPurpose)

	_, err = w.sm.Process(t.Context(), def, afterIdentify.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "fresh-secret"},
	})
	require.NoError(t, err)
}

// passkeyRegisterDefinition builds a two-step registration flow:
// an `identify` step (identifier field) followed by a `register` step
// offering the `passkey_register` action, transitioning to `done`.
func passkeyRegisterDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-passkey-reg",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "register",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name: "register",
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionPasskeyRegister, Kind: domain.FlowActionKindPasskeyRegister, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionPasskeyRegister: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

func passkeyRegisterAfterIdentifierDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-passkey-reg-with-identifier",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeRegister: "identify",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identify",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "register"},
				},
			},
			{
				Name: "register",
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionPasskeyRegister, Kind: domain.FlowActionKindPasskeyRegister, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionPasskeyRegister: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

func passkeyRegisterAfterUsernameAndEmailDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-passkey-reg-with-username-and-email",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeRegister: "identify",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identify",
				Fields: []domain.Field{"username", "email"},
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "register"},
				},
			},
			{
				Name: "register",
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionPasskeyRegister, Kind: domain.FlowActionKindPasskeyRegister, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionPasskeyRegister: {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}
}

func TestFlowStateMachine_Process_PasskeyRegisterIssueThenVerify(t *testing.T) {
	t.Parallel()
	const userID = "user_01TEST"
	const challengeID = "reg-1"
	const registrationOpts = `{"rp":{"id":"example.com"}}`
	const proof = `{"attestation":"fake"}`

	w := newFlowTestWorld(t)
	def := passkeyRegisterDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		IssuePasskeyRegistrationChallenge(gomock.Any(), gomock.Cond(func(in domain.FlowIssuePasskeyRegistrationChallengeInput) bool {
			return assert.Equal(t, "attempt-1", in.AttemptID) && assert.Empty(t, in.UserID)
		})).
		Return(domain.FlowPasskeyRegistrationChallengeOutput{
			ChallengeID: challengeID,
			UserID:      userID,
			Options:     []byte(registrationOpts),
		}, nil)
	w.authAttemptService.EXPECT().
		SubmitPasskeyRegistration(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitPasskeyRegistrationInput) bool {
			return assert.Equal(t, "attempt-1", in.AttemptID) &&
				assert.Equal(t, userID, in.UserID) &&
				assert.Equal(t, challengeID, in.ChallengeID) &&
				assert.Equal(t, proof, string(in.Attestation))
		}))
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Any()).
		Return(domain.FlowHandoffOutput{
			Token:     "handoff_01TEST",
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		}, nil)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Issue leg: passkey_register action mints a creation challenge.
	issued, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskeyRegister,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.Step.Challenge)
	assert.Equal(t, challengeID, issued.Step.Challenge.ChallengeID)
	assert.Equal(t, domain.FlowChallengeMethodPasskeyRegister, issued.Step.Challenge.Method)
	require.NotNil(t, issued.State.PendingChallenge)

	// Verify leg: attestation clears the challenge and advances to done.
	verified, err := w.sm.Process(t.Context(), def, issued.State, domain.FlowSubmitInput{
		Action: domain.FlowActionPasskeyRegister,
		ChallengeResponse: &domain.FlowChallengeResponse{
			ChallengeID: "reg-1",
			Method:      domain.FlowChallengeMethodPasskeyRegister,
			Proof:       []byte(proof),
		},
	})
	require.NoError(t, err)
	assert.Nil(t, verified.State.PendingChallenge)
	require.NotNil(t, verified.Step.Complete)
	// Passkey registration writes a credential — irreversible. The back
	// stack drops so no `back` action leaks past the mutation boundary,
	// while History keeps the visitation trail.
	assert.Empty(t, verified.State.BackStack, "passkey-register verify must clear the back stack")
	assert.Equal(t, []string{"register"}, verified.State.History, "audit history records the visit even after an irreversible advance")
}

func TestFlowStateMachine_Process_PasskeyRegisterRejectedKeepsStep(t *testing.T) {
	t.Parallel()
	const userID = "user_alice"
	const challengeID = "reg-1"
	const registrationOpts = `{}`
	const proof = `{}`

	w := newFlowTestWorld(t)
	def := passkeyRegisterDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		IssuePasskeyRegistrationChallenge(gomock.Any(), gomock.Cond(func(in domain.FlowIssuePasskeyRegistrationChallengeInput) bool {
			return assert.Equal(t, userID, in.UserID)
		})).
		Return(domain.FlowPasskeyRegistrationChallengeOutput{
			ChallengeID: challengeID,
			UserID:      userID,
			Options:     []byte(registrationOpts),
		}, nil)
	w.authAttemptService.EXPECT().
		SubmitPasskeyRegistration(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitPasskeyRegistrationInput) bool {
			return assert.Equal(t, challengeID, in.ChallengeID) &&
				assert.Equal(t, proof, string(in.Attestation))
		})).
		Return(domain.ErrAuthAttemptProofRejected(nil))

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	start.State.CollectedData.UserID = "user_alice"

	issued, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskeyRegister,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	rejected, err := w.sm.Process(t.Context(), def, issued.State, domain.FlowSubmitInput{
		Action: domain.FlowActionPasskeyRegister,
		ChallengeResponse: &domain.FlowChallengeResponse{
			ChallengeID: "reg-1",
			Method:      domain.FlowChallengeMethodPasskeyRegister,
			Proof:       []byte(proof),
		},
	})
	require.NoError(t, err)
	require.NotNil(t, rejected.Step.Error)
	assert.Equal(t, domain.FlowStepErrorPasskeyRegistrationInvalid, *rejected.Step.Error)
	assert.Nil(t, rejected.State.PendingChallenge)
	assert.Equal(t, "register", rejected.State.CurrentStep)
}

// TestFlowStateMachine_Process_PasskeyRegisterGeneratesUserID verifies that
// when no user is identified yet (passkey-only registration path), the attempt
// service mints a provisional user handle (returned on the issue output) and
// the state machine stores it for the verify phase.
func TestFlowStateMachine_Process_PasskeyRegisterGeneratesUserID(t *testing.T) {
	t.Parallel()
	const challengeID = "reg-1"
	const registrationOpts = `{"rp":{"id":"example.com"}}`
	const userID = "user_01TEST"
	w := newFlowTestWorld(t)
	def := passkeyRegisterDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		IssuePasskeyRegistrationChallenge(gomock.Any(), gomock.Cond(func(in domain.FlowIssuePasskeyRegistrationChallengeInput) bool {
			return assert.Empty(t, in.UserID) &&
				assert.Empty(t, in.Username) &&
				assert.Empty(t, in.DisplayName)
		})).
		Return(domain.FlowPasskeyRegistrationChallengeOutput{
			ChallengeID: challengeID,
			UserID:      userID,
			Options:     []byte(registrationOpts),
		}, nil)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	issued, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskeyRegister,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.Step.Challenge)
	assert.Equal(t, userID, issued.State.CollectedData.UserID)
}

func TestFlowStateMachine_Process_PasskeyRegisterUsesCollectedIdentifierForDisplay(t *testing.T) {
	t.Parallel()
	const email = "alice@example.com"
	const challengeID = "reg-1"
	const registrationOpts = `{"rp":{"id":"example.com"}}`
	const userID = "user_01TEST"
	w := newFlowTestWorld(t)
	def := passkeyRegisterAfterIdentifierDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return assert.Equal(t, "email", in.AttributeName) &&
				assert.Equal(t, email, in.Value)
		})).
		Return("", domain.ErrAuthAttemptProofRejected(nil))
	w.authAttemptService.EXPECT().
		IssuePasskeyRegistrationChallenge(gomock.Any(), gomock.Cond(func(in domain.FlowIssuePasskeyRegistrationChallengeInput) bool {
			return assert.Empty(t, in.UserID) &&
				assert.Equal(t, email, in.Username) &&
				assert.Equal(t, email, in.DisplayName)
		})).
		Return(domain.FlowPasskeyRegistrationChallengeOutput{
			ChallengeID: challengeID,
			UserID:      userID,
			Options:     []byte(registrationOpts),
		}, nil)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	registerStep, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	assert.Equal(t, "register", registerStep.Step.Name)

	issued, err := w.sm.Process(t.Context(), def, registerStep.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskeyRegister,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.Step.Challenge)
	assert.Equal(t, challengeID, issued.Step.Challenge.ChallengeID)
}

// TestFlowStateMachine_Process_PasskeyRegisterConflictPinsExistingUser covers
// the uniqueness race on a provisional registration: the verify transaction
// rolls back, and before routing user_already_exists the engine re-resolves
// the collected identifier so the existing user is pinned on the attempt —
// the downstream password step requires a persisted user factor.
func TestFlowStateMachine_Process_PasskeyRegisterConflictPinsExistingUser(t *testing.T) {
	t.Parallel()
	const email = "alice@example.com"
	const challengeID = "reg-1"
	const registrationOpts = `{"rp":{"id":"example.com"}}`
	const mintedUserID = "user_prov01"
	const existingUserID = "user_existing01"
	w := newFlowTestWorld(t)
	def := passkeyRegisterAfterIdentifierDefinition()
	def.Steps[1].Transitions[domain.FlowImplicitOutcomeUserAlreadyExists] = domain.FlowStepTransition{Target: "password"}
	def.Steps = append(def.Steps, domain.FlowDefinitionStep{
		Name: "password",
		Actions: []domain.FlowStepAction{
			{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
		},
		Transitions: map[string]domain.FlowStepTransition{
			domain.FlowActionSubmit: {Target: "done"},
		},
	})

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	// Identify step: the email is unknown, so register mode continues.
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil))
	w.authAttemptService.EXPECT().
		IssuePasskeyRegistrationChallenge(gomock.Any(), gomock.Any()).
		Return(domain.FlowPasskeyRegistrationChallengeOutput{
			ChallengeID: challengeID,
			UserID:      mintedUserID,
			Options:     []byte(registrationOpts),
		}, nil)
	// Verify leg loses the uniqueness race...
	w.authAttemptService.EXPECT().
		SubmitPasskeyRegistration(gomock.Any(), gomock.Any()).
		Return(domain.ErrUserAlreadyExists())
	// ...and the engine re-resolves the collected identifier to pin the
	// conflicting existing user on the attempt.
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return assert.Equal(t, "email", in.AttributeName) &&
				assert.Equal(t, email, in.Value)
		})).
		Return(existingUserID, nil)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	registerStep, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	require.Equal(t, "register", registerStep.Step.Name)

	issued, err := w.sm.Process(t.Context(), def, registerStep.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskeyRegister,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	conflicted, err := w.sm.Process(t.Context(), def, issued.State, domain.FlowSubmitInput{
		Action: domain.FlowActionPasskeyRegister,
		ChallengeResponse: &domain.FlowChallengeResponse{
			ChallengeID: challengeID,
			Method:      domain.FlowChallengeMethodPasskeyRegister,
			Proof:       []byte(`{"attestation":"conflicting"}`),
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "password", conflicted.State.CurrentStep,
		"user_already_exists must follow the declared transition")
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, conflicted.State.CurrentPurpose,
		"the conflict flips back to login for verification")
	assert.Equal(t, existingUserID, conflicted.State.CollectedData.UserID,
		"the conflicting existing user must be pinned for the password step")
	assert.Nil(t, conflicted.State.PendingChallenge)
}

// TestFlowStateMachine_Process_PasskeyRegisterConflictOnSecondUniqueField
// covers a multi-unique schema losing the race on a non-identifier attribute:
// the sign-up email is fresh but the username is taken. Re-resolution must try
// every collected identifier-class field (every x-unique property resolves as
// one), not just the first, to pin the actually-conflicting owner.
func TestFlowStateMachine_Process_PasskeyRegisterConflictOnSecondUniqueField(t *testing.T) {
	t.Parallel()
	const email = "alice@example.com"
	const username = "alice"
	const challengeID = "reg-1"
	const registrationOpts = `{"rp":{"id":"example.com"}}`
	const existingUserID = "user_existing01"
	w := newFlowTestWorld(t)
	def := passkeyRegisterAfterUsernameAndEmailDefinition()
	def.Steps[1].Transitions[domain.FlowImplicitOutcomeUserAlreadyExists] = domain.FlowStepTransition{Target: "password"}
	def.Steps = append(def.Steps, domain.FlowDefinitionStep{
		Name: "password",
		Actions: []domain.FlowStepAction{
			{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
		},
		Transitions: map[string]domain.FlowStepTransition{
			domain.FlowActionSubmit: {Target: "done"},
		},
	})

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	// Identify step dispatches the first identifier field; unknown → register
	// mode continues.
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Any()).
		Return("", domain.ErrAuthAttemptProofRejected(nil))
	w.authAttemptService.EXPECT().
		IssuePasskeyRegistrationChallenge(gomock.Any(), gomock.Any()).
		Return(domain.FlowPasskeyRegistrationChallengeOutput{
			ChallengeID: challengeID,
			UserID:      "user_prov01",
			Options:     []byte(registrationOpts),
		}, nil)
	// Verify loses the uniqueness race (on the email, not the username).
	w.authAttemptService.EXPECT().
		SubmitPasskeyRegistration(gomock.Any(), gomock.Any()).
		Return(domain.ErrUserAlreadyExists())
	// Re-resolution walks the identifier-class candidates in field order:
	// the username is fresh (rejected), the email resolves the owner.
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return in.AttributeName == "username" && in.Value == username
		})).
		Return("", domain.ErrAuthAttemptProofRejected(nil))
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return in.AttributeName == "email" && in.Value == email
		})).
		Return(existingUserID, nil)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	registerStep, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": email, "username": username},
	})
	require.NoError(t, err)
	require.Equal(t, "register", registerStep.Step.Name)

	issued, err := w.sm.Process(t.Context(), def, registerStep.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskeyRegister,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	conflicted, err := w.sm.Process(t.Context(), def, issued.State, domain.FlowSubmitInput{
		Action: domain.FlowActionPasskeyRegister,
		ChallengeResponse: &domain.FlowChallengeResponse{
			ChallengeID: challengeID,
			Method:      domain.FlowChallengeMethodPasskeyRegister,
			Proof:       []byte(`{"attestation":"conflicting"}`),
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "password", conflicted.State.CurrentStep)
	assert.Equal(t, existingUserID, conflicted.State.CollectedData.UserID,
		"the owner of the conflicting username must be pinned, not the fresh email's non-owner")
}

// TestFlowStateMachine_Process_PasskeyRegisterStaleChallengeUnsticks covers a
// ceremony outliving its 5-minute window inside a still-alive attempt: the
// stale verify must clear the pending challenge and render on the step, so
// the retry mints a fresh ceremony instead of re-emitting the stale one.
func TestFlowStateMachine_Process_PasskeyRegisterStaleChallengeUnsticks(t *testing.T) {
	t.Parallel()
	const registrationOpts = `{"rp":{"id":"example.com"}}`
	w := newFlowTestWorld(t)
	def := passkeyRegisterDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		IssuePasskeyRegistrationChallenge(gomock.Any(), gomock.Any()).
		Return(domain.FlowPasskeyRegistrationChallengeOutput{
			ChallengeID: "reg-1",
			UserID:      "user_prov01",
			Options:     []byte(registrationOpts),
		}, nil)
	w.authAttemptService.EXPECT().
		SubmitPasskeyRegistration(gomock.Any(), gomock.Any()).
		Return(domain.ErrAuthAttemptStaleChallenge())
	// The retry after the stale render mints a fresh ceremony.
	w.authAttemptService.EXPECT().
		IssuePasskeyRegistrationChallenge(gomock.Any(), gomock.Any()).
		Return(domain.FlowPasskeyRegistrationChallengeOutput{
			ChallengeID: "reg-2",
			UserID:      "user_prov01",
			Options:     []byte(registrationOpts),
		}, nil)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	issued, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskeyRegister,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	stale, err := w.sm.Process(t.Context(), def, issued.State, domain.FlowSubmitInput{
		Action: domain.FlowActionPasskeyRegister,
		ChallengeResponse: &domain.FlowChallengeResponse{
			ChallengeID: "reg-1",
			Method:      domain.FlowChallengeMethodPasskeyRegister,
			Proof:       []byte(`{"attestation":"late"}`),
		},
	})
	require.NoError(t, err)
	require.NotNil(t, stale.Step.Error)
	assert.Equal(t, domain.FlowStepErrorPasskeyRegistrationInvalid, *stale.Step.Error)
	assert.Nil(t, stale.State.PendingChallenge,
		"a stale ceremony must be cleared so the retry can mint a fresh one")

	retried, err := w.sm.Process(t.Context(), def, stale.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskeyRegister,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, retried.State.PendingChallenge)
	assert.Equal(t, "reg-2", retried.State.PendingChallenge.ID)
}

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
					{Name: domain.FlowActionPasskey},
					{Name: domain.FlowActionSubmit, Primary: true},
					{Name: "register"},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionPasskey: {Target: "done"},
					domain.FlowActionSubmit:  {Target: "done"},
					"register":               {Target: "done"},
				},
			},
			{Name: "done", Complete: &show},
		},
	}

	result, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	gotNames := make([]string, len(result.Step.Actions))
	for i, a := range result.Step.Actions {
		gotNames[i] = a.Name
	}
	assert.Equal(t, []string{domain.FlowActionPasskey, domain.FlowActionSubmit, "register"}, gotNames)
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
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
					{Name: "cancel", Kind: domain.FlowActionKindNavigate},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "done"},
					"cancel":                {Target: "landing"},
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Empty fields would fail validation under a submit action; navigate
	// must skip validation and follow the transition.
	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
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

// findBackAction returns the engine-injected back action on a rendered
// step, or nil if it isn't present. Tests key on kind, not name — the
// contract is kind-driven.
func findBackAction(step *domain.FlowStep) *domain.FlowAction {
	if step == nil {
		return nil
	}
	for i, a := range step.Actions {
		if a.Kind == domain.FlowActionKindBack {
			return &step.Actions[i]
		}
	}
	return nil
}

func findFieldByName(fields []domain.FlowField, name string) *domain.FlowField {
	for i, f := range fields {
		if f.Name == name {
			return &fields[i]
		}
	}
	return nil
}

func TestFlowStateMachine_Back_NotInjectedOnInitialStep(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := navigateOnlyDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{Action: "go"})
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	mid, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{Action: "go"})
	require.NoError(t, err)
	term, err := w.sm.Process(t.Context(), def, mid.State, domain.FlowSubmitInput{Action: "go"})
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	advanced, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{Action: "go"})
	require.NoError(t, err)
	require.Equal(t, "step2", advanced.Step.Name)

	back, err := w.sm.Process(t.Context(), def, advanced.State, domain.FlowSubmitInput{Action: "back"})
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Client-synthesized back on the initial step must be rejected.
	_, err = w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{Action: "back"})
	require.Error(t, err)
	assert.ErrorIs(t, err, domain.ErrFlowInvalidAction())
}

// loginRegisterFlipDefinition mirrors the shape of the default flow:
// unknown email on the identifier step routes to a non-terminal
// register step, so the login→register purpose flip can be exercised
// (and reverted by back).
func loginRegisterFlipDefinition() *domain.FlowDefinition {
	show := domain.FlowStepCompleteShow
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-login-register-flip",
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
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit:                {Target: "password"},
					domain.FlowImplicitOutcomeUserNotFound: {Target: "register"},
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
			{
				Name:   "register",
				Fields: []domain.Field{"email"},
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.Equal(t, domain.FlowDefinitionPurposeLogin, start.State.CurrentPurpose)

	// Submit unknown email → user_not_found flips CurrentPurpose to register.
	afterSubmit, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "ghost@example.com"},
	})
	require.NoError(t, err)
	require.Equal(t, "register", afterSubmit.Step.Name)
	require.Equal(t, domain.FlowDefinitionPurposeRegister, afterSubmit.State.CurrentPurpose)

	// Back must restore the identifier step AND the login purpose.
	afterBack, err := w.sm.Process(t.Context(), def, afterSubmit.State, domain.FlowSubmitInput{Action: "back"})
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	result, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	s2, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{Action: "go"})
	require.NoError(t, err)
	s3, err := w.sm.Process(t.Context(), def, s2.State, domain.FlowSubmitInput{Action: "go"})
	require.NoError(t, err)
	require.Equal(t, "step3", s3.Step.Name)
	require.Len(t, s3.State.BackStack, 2)

	back1, err := w.sm.Process(t.Context(), def, s3.State, domain.FlowSubmitInput{Action: "back"})
	require.NoError(t, err)
	assert.Equal(t, "step2", back1.Step.Name)
	require.Len(t, back1.State.BackStack, 1)
	assert.NotNil(t, findBackAction(back1.Step))

	back2, err := w.sm.Process(t.Context(), def, back1.State, domain.FlowSubmitInput{Action: "back"})
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	const email = "ghost@example.com"
	afterSubmit, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	require.Equal(t, "register", afterSubmit.Step.Name)

	afterBack, err := w.sm.Process(t.Context(), def, afterSubmit.State, domain.FlowSubmitInput{Action: "back"})
	require.NoError(t, err)
	require.Equal(t, "identifier", afterBack.Step.Name)
	// The email survives back so the previous form pre-fills.
	assert.Equal(t, email, afterBack.State.CollectedData.UserData["email"])
	require.NotEmpty(t, afterBack.Step.Fields)
	if emailField := findFieldByName(afterBack.Step.Fields, "email"); assert.NotNil(t, emailField) && emailField.Value != nil {
		assert.Equal(t, email, *emailField.Value, "identifier step must prefill from CollectedData on back")
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
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "confirm"},
				},
			},
			{
				Name:   "confirm",
				Fields: []domain.Field{"address.street", "address.city", "address.geo.label"},
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// A nested leaf renders as an ordinary scalar field named by its path.
	streetField := findFieldByName(start.Step.Fields, "address.street")
	require.NotNil(t, streetField)
	assert.Equal(t, domain.FlowFieldTypeText, streetField.Type)
	assert.False(t, streetField.Required, "leaf under an optional parent is not required")

	res, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
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
	final, err := w.sm.Process(t.Context(), def, res.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
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

func TestFlowStateMachine_Back_DropsPendingChallenge(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)
	def := navigateOnlyDefinition()

	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att_1", nil)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	advanced, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{Action: "go"})
	require.NoError(t, err)

	// Simulate a ceremony pending on step2. The challenge id is bound to
	// step2; back must drop it so a downstream verify can't resurrect it
	// against a different step.
	advanced.State.PendingChallenge = &domain.FlowPendingChallenge{ID: "ch-1", Method: domain.FlowChallengeMethodPasskey}

	afterBack, err := w.sm.Process(t.Context(), def, advanced.State, domain.FlowSubmitInput{Action: "back"})
	require.NoError(t, err)
	assert.Equal(t, "step1", afterBack.Step.Name)
	assert.Nil(t, afterBack.State.PendingChallenge, "back must drop the pending challenge")
}

// TestFlowStepErrorContract sweeps every value the engine can emit as
// `step.Error` and pins the client contract: a localizable `error.*`
// text key or a reserved outcome token. The scenario tests above prove
// each value is emitted where expected; this gate is what fails when a
// new emission value (a step-error const, an implicit outcome, a
// validation rule) breaks the dialect /login localizes.
func TestFlowStepErrorContract(t *testing.T) {
	t.Parallel()

	stepErrorConsts := []string{
		domain.FlowStepErrorInvalidCredentials,
		domain.FlowStepErrorPasskeyInvalid,
		domain.FlowStepErrorPasskeyRegistrationInvalid,
		domain.FlowStepErrorSSOCreationDisabled,
		domain.FlowStepErrorSSOUnavailable,
		domain.FlowStepErrorSSOCancelled,
		domain.FlowStepErrorSSOFailed,
	}
	for _, key := range stepErrorConsts {
		assert.True(t, domain.FlowStepErrorAllowed(key), "step-error const %q must honor the contract", key)
	}

	challenges := []domain.FlowFieldChallenge{
		domain.FlowFieldChallengeNone,
		domain.FlowFieldChallengeIdentifier,
		domain.FlowFieldChallengePassword,
		domain.FlowFieldChallengePasskey,
		domain.FlowFieldChallengeMagicLink,
		domain.FlowFieldChallengeSSO,
		domain.FlowFieldChallengeOTP,
	}
	for _, challenge := range challenges {
		for _, outcome := range domain.ImplicitOutcomesForChallenge(challenge) {
			// Unwired transitions surface the outcome token verbatim as
			// step.Error, so every implicit outcome must stay reserved.
			assert.True(t, domain.FlowStepErrorAllowed(outcome),
				"implicit outcome %q of challenge %q must be a reserved token", outcome, challenge)
		}
	}
	assert.True(t, domain.FlowStepErrorAllowed(domain.FlowImplicitOutcomeUserNotFound))
	assert.True(t, domain.FlowStepErrorAllowed(domain.FlowImplicitOutcomeUserAlreadyExists))

	rules := []domain.FlowFieldValidationRule{
		domain.FlowFieldValidationRuleRequired,
		domain.FlowFieldValidationRuleFormat,
		domain.FlowFieldValidationRuleMinLength,
		domain.FlowFieldValidationRuleMaxLength,
		domain.FlowFieldValidationRuleUnknown,
	}
	// Field names are tenant-controlled and used verbatim in the key —
	// the credential shape is the adversarial case.
	for _, field := range []string{"email", "x-auth-methods#password"} {
		for _, rule := range rules {
			key := domain.FlowFieldValidationError{Field: field, Rule: rule}.TextKey()
			assert.True(t, domain.FlowStepErrorAllowed(key),
				"validation key %q (field %q, rule %q) must honor the contract", key, field, rule)
		}
	}

	for _, key := range []string{"auth_attempt.password_invalid", "password_invalid", ""} {
		assert.False(t, domain.FlowStepErrorAllowed(key), "%q must not pass the contract", key)
	}
}

// purposeNavDefinition mirrors the shipped default-login shape: separate
// login and register entry steps joined by navigate-kind actions whose
// transitions declare a local purpose (the ADR 026 amendment). "register"
// on the identifier step re-purposes to register; "sign_in" on the
// register step re-purposes back to login.
func purposeNavDefinition() *domain.FlowDefinition {
	createUser := domain.FlowOnSuccessCreateUser
	show := domain.FlowStepCompleteShow
	login := domain.FlowDefinitionPurposeLogin
	register := domain.FlowDefinitionPurposeRegister
	return &domain.FlowDefinition{
		ProjectID:  testProjectID,
		ID:         "def-purpose-nav",
		UserSchema: defaultSchemaURL,
		Purposes: map[domain.FlowDefinitionPurpose]string{
			login:    "identifier",
			register: "register",
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:   "identifier",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
					{Name: domain.FlowActionPasskey, Kind: domain.FlowActionKindPasskey},
					{Name: "register", Kind: domain.FlowActionKindNavigate},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit:                {Target: "password"},
					domain.FlowActionPasskey:               {Target: "done"},
					"register":                             {Target: "register", Purpose: &register},
					domain.FlowImplicitOutcomeUserNotFound: {Target: "register"},
				},
			},
			{
				// The password step offers passkey too, as
				// default-login.json does: "sign in with a passkey" stays
				// reachable for a user who cannot recall their password.
				Name:   "password",
				Fields: []domain.Field{"x-auth-methods#password"},
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
					{Name: domain.FlowActionPasskey, Kind: domain.FlowActionKindPasskey},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit:  {Target: "done"},
					domain.FlowActionPasskey: {Target: "done"},
				},
			},
			{
				Name:   "register",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
					{Name: "sign_in", Kind: domain.FlowActionKindNavigate},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "register-password"},
					"sign_in":               {Target: "identifier", Purpose: &login},
					domain.FlowImplicitOutcomeUserAlreadyExists: {Target: "password"},
				},
			},
			{
				Name:      "register-password",
				Fields:    []domain.Field{"x-auth-methods#password"},
				OnSuccess: &createUser,
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.Equal(t, domain.FlowDefinitionPurposeLogin, start.State.CurrentPurpose)

	toRegister, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: "register",
		Fields: map[string]any{},
	})
	require.NoError(t, err)
	assert.Equal(t, "register", toRegister.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, toRegister.State.CurrentPurpose)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, toRegister.State.Purpose,
		"the pinned Purpose must not move on a local re-purpose")

	toLogin, err := w.sm.Process(t.Context(), def, toRegister.State, domain.FlowSubmitInput{
		Action: "sign_in",
		Fields: map[string]any{},
	})
	require.NoError(t, err)
	assert.Equal(t, "identifier", toLogin.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, toLogin.State.CurrentPurpose)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, toLogin.State.Purpose)
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	toRegister, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: "register",
	})
	require.NoError(t, err)
	require.Equal(t, domain.FlowDefinitionPurposeRegister, toRegister.State.CurrentPurpose)

	back, err := w.sm.Process(t.Context(), def, toRegister.State, domain.FlowSubmitInput{
		Action: "back",
	})
	require.NoError(t, err)
	assert.Equal(t, "identifier", back.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, back.State.CurrentPurpose,
		"back across a purposed navigation must restore the snapshotted purpose")
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
		IssuePasskeyChallenge(gomock.Any(), gomock.Any()).
		Return(domain.FlowPasskeyChallengeOutput{ChallengeID: "ch-1", Options: []byte(`{"publicKey":{}}`)}, nil)
	// navigation abandons the ceremony; no verification may run
	w.authAttemptService.EXPECT().SubmitPasskey(gomock.Any(), gomock.Any()).Times(0)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	issued, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	navigated, err := w.sm.Process(t.Context(), def, issued.State, domain.FlowSubmitInput{
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
		Handle(gomock.Any(), gomock.Cond(func(in domain.FlowOnSuccessInput) bool {
			return in.State.CollectedData.UserData["email"] == email
		})).
		Return(domain.FlowOnSuccessResult{UserID: "user-id1"}, nil)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), gomock.Any()).
		Return(domain.FlowHandoffOutput{
			Token:     "handoff_01TEST",
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		}, nil)
	// register mode never verifies a password
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Times(0)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	toRegister, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: "register",
	})
	require.NoError(t, err)
	require.Equal(t, domain.FlowDefinitionPurposeRegister, toRegister.State.CurrentPurpose)

	afterEmail, err := w.sm.Process(t.Context(), def, toRegister.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	assert.Equal(t, "register-password", afterEmail.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, afterEmail.State.CurrentPurpose)

	done, err := w.sm.Process(t.Context(), def, afterEmail.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
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
			SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
				return in.AttemptID == "attempt-1"
			})).
			Return("user_alice", nil),
		w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-2", nil),
		w.authAttemptService.EXPECT().
			SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
				return in.AttemptID == "attempt-2"
			})).
			Return("user_alice", nil),
	)
	// The register leg must never issue a passkey registration or create a
	// user for the login-resolved account.
	w.authAttemptService.EXPECT().IssuePasskeyChallenge(gomock.Any(), gomock.Any()).Times(0)
	w.createUser.EXPECT().Handle(gomock.Any(), gomock.Any()).Times(0)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Login mode resolves the existing user.
	afterIdentify, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	require.Equal(t, "password", afterIdentify.State.CurrentStep)
	require.Equal(t, "user_alice", afterIdentify.State.CollectedData.UserID)

	back, err := w.sm.Process(t.Context(), def, afterIdentify.State, domain.FlowSubmitInput{
		Action: "back",
	})
	require.NoError(t, err)
	require.Equal(t, "identifier", back.State.CurrentStep)

	// "Sign up" must start register mode fresh: no resolved user and no
	// collected credential material.
	toRegister, err := w.sm.Process(t.Context(), def, back.State, domain.FlowSubmitInput{
		Action: "register",
	})
	require.NoError(t, err)
	assert.Equal(t, "register", toRegister.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, toRegister.State.CurrentPurpose)
	assert.Equal(t, "attempt-2", toRegister.State.AuthAttemptID,
		"a re-purpose after identification must rotate the auth attempt")
	assert.Empty(t, toRegister.State.CollectedData.UserID,
		"the login-resolved user must not survive a declared re-purpose")
	assert.Empty(t, toRegister.State.CollectedData.AuthMethods.Password)

	// Re-identifying the same existing email in register mode routes
	// through user_already_exists into password verification.
	guarded, err := w.sm.Process(t.Context(), def, toRegister.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	assert.Equal(t, "password", guarded.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, guarded.State.CurrentPurpose,
		"user_already_exists must flip back to login for verification")
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	afterIdentify, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	require.Equal(t, "password", afterIdentify.State.CurrentStep)
	require.Equal(t, "user_alice", afterIdentify.State.CollectedData.UserID)

	// A rejected password holds the user on the step — this is what sends
	// them looking for the back action in the first place.
	afterWrongPassword, err := w.sm.Process(t.Context(), def, afterIdentify.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "not-the-password"},
	})
	require.NoError(t, err)
	require.Equal(t, "password", afterWrongPassword.State.CurrentStep)
	require.NotNil(t, afterWrongPassword.Step.Error)
	require.Equal(t, domain.FlowStepErrorInvalidCredentials, *afterWrongPassword.Step.Error)
	// mergeCollected banks the password before the proof is checked, so the
	// rejected one is sitting in state at this point.
	require.Equal(t, "not-the-password", afterWrongPassword.State.CollectedData.AuthMethods.Password)

	back, err := w.sm.Process(t.Context(), def, afterWrongPassword.State, domain.FlowSubmitInput{
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
	reIdentified, err := w.sm.Process(t.Context(), def, back.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
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
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "password"},
				},
			},
			{
				Name:   "password",
				Fields: []domain.Field{"x-auth-methods#password"},
				Actions: []domain.FlowStepAction{
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "confirm"},
				},
			},
			{
				Name: "confirm",
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	afterIdentify, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": email},
	})
	require.NoError(t, err)
	require.Equal(t, "password", afterIdentify.State.CurrentStep)

	afterPassword, err := w.sm.Process(t.Context(), def, afterIdentify.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "very-good-password-1"},
	})
	require.NoError(t, err)
	require.Equal(t, "confirm", afterPassword.State.CurrentStep)
	require.Equal(t, "user_alice", afterPassword.State.CollectedData.UserID)

	back, err := w.sm.Process(t.Context(), def, afterPassword.State, domain.FlowSubmitInput{
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.Equal(t, "register", start.State.CurrentStep)

	flipped, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": taken},
	})
	require.NoError(t, err)
	require.Equal(t, "password", flipped.State.CurrentStep)
	require.Equal(t, domain.FlowDefinitionPurposeLogin, flipped.State.CurrentPurpose)
	require.Equal(t, "user_alice", flipped.State.CollectedData.UserID,
		"user_already_exists pins the user on the attempt, so the flow must record it")

	back, err := w.sm.Process(t.Context(), def, flipped.State, domain.FlowSubmitInput{
		Action: "back",
	})
	require.NoError(t, err)
	require.Equal(t, "register", back.State.CurrentStep)
	assert.Equal(t, "attempt-2", back.State.AuthAttemptID,
		"back after user_already_exists must rotate the auth attempt")
	assert.Empty(t, back.State.CollectedData.UserID)

	// A different address on the rotated attempt resolves normally; on the
	// old one it would have died on "The user was already authenticated".
	retried, err := w.sm.Process(t.Context(), def, back.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// user_not_found routes on to register with nothing resolved.
	flipped, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "ghost@example.com"},
	})
	require.NoError(t, err)
	require.Equal(t, "register", flipped.State.CurrentStep)

	back, err := w.sm.Process(t.Context(), def, flipped.State, domain.FlowSubmitInput{
		Action: "back",
	})
	require.NoError(t, err)
	require.Equal(t, "identifier", back.State.CurrentStep)
	assert.Equal(t, "attempt-1", back.State.AuthAttemptID)
}

// TestFlowStateMachine_Process_PasskeyOnPasswordStepSkipsPasswordCheck pins
// the passkey action as a non-submission of the password step's field.
// Browsers post the whole form, so the field rides along with the action, and
// both the value it carries and the value it lacks used to sink the leg
// before the WebAuthn prompt ever appeared: an empty box failed the
// required-field check, and a filled one was verified as a password. Neither
// is a password submission.
func TestFlowStateMachine_Process_PasskeyOnPasswordStepSkipsPasswordCheck(t *testing.T) {
	t.Parallel()
	const email = "alice@example.com"
	const challengeID = "ch-1"
	const rpid = "example.com"

	// The password field is required with min_length 8, so an empty value
	// trips "required" and a short one trips the length rule. Both are the
	// browser's form state, not something the user submitted.
	passwordFields := map[string]string{
		"empty box":                  "",
		"below the length minimum":   "short",
		"the identifier left behind": email,
	}

	for name, password := range passwordFields {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w := newFlowTestWorld(t)
			def := purposeNavDefinition()

			w.schemaResolver.EXPECT().
				Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
				Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
				AnyTimes()
			w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
			w.authAttemptService.EXPECT().
				SubmitIdentifier(gomock.Any(), gomock.Any()).
				Return("user_alice", nil).
				Times(1)
			w.authAttemptService.EXPECT().
				SubmitPassword(gomock.Any(), gomock.Any()).
				Times(0)
			w.authAttemptService.EXPECT().
				IssuePasskeyChallenge(gomock.Any(), gomock.Cond(func(in domain.FlowIssuePasskeyChallengeInput) bool {
					return in.RPID == rpid
				})).
				Return(domain.FlowPasskeyChallengeOutput{ChallengeID: challengeID, Options: []byte(`{"publicKey":{}}`)}, nil).
				Times(1)

			start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
				Definition:    def,
				Purpose:       domain.FlowDefinitionPurposeLogin,
				Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
				UserSchemaURL: defaultSchemaURL,
			})
			require.NoError(t, err)

			afterIdentify, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
				Action: domain.FlowActionSubmit,
				Fields: map[string]any{"email": email},
			})
			require.NoError(t, err)
			require.Equal(t, "password", afterIdentify.State.CurrentStep)

			issued, err := w.sm.Process(t.Context(), def, afterIdentify.State, domain.FlowSubmitInput{
				Action:    domain.FlowActionPasskey,
				Fields:    map[string]any{"x-auth-methods#password": password},
				PasskeyRP: &domain.FlowPasskeyRP{RPID: rpid, Origins: []string{"https://example.com"}},
			})
			require.NoError(t, err)
			assert.Nil(t, issued.Step.Error, "the passkey action must not fail on the password field")
			require.NotNil(t, issued.Step.Challenge)
			assert.Equal(t, challengeID, issued.Step.Challenge.ChallengeID)
			assert.Equal(t, domain.FlowChallengeMethodPasskey, issued.Step.Challenge.Method)
			assert.Equal(t, "password", issued.State.CurrentStep, "the issue leg halts on the same step")
			assert.Empty(t, issued.State.CollectedData.AuthMethods.Password,
				"a field the leg does not submit must not be collected either")
		})
	}
}

// TestFlowStateMachine_Process_PasskeyStillIdentifies keeps the other half:
// the identifier is the one field a passkey login leg does consume, so it
// still reaches SubmitIdentifier and still answers to its own rules.
func TestFlowStateMachine_Process_PasskeyStillIdentifies(t *testing.T) {
	t.Parallel()
	const email = "alice@example.com"
	const challengeID = "ch-1"
	const rpid = "example.com"
	w := newFlowTestWorld(t)
	def := purposeNavDefinition()

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	w.authAttemptService.EXPECT().
		SubmitIdentifier(gomock.Any(), gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
			return in.AttributeName == "email" && in.Value == email
		})).
		Return("user_alice", nil).
		Times(1)
	w.authAttemptService.EXPECT().
		IssuePasskeyChallenge(gomock.Any(), gomock.Any()).
		Return(domain.FlowPasskeyChallengeOutput{ChallengeID: challengeID, Options: []byte(`{"publicKey":{}}`)}, nil).
		Times(1)

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	issued, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		Fields:    map[string]any{"email": email},
		PasskeyRP: &domain.FlowPasskeyRP{RPID: rpid, Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.Step.Challenge)
	assert.Equal(t, "user_alice", issued.State.CollectedData.UserID,
		"the identifier a passkey leg carries still resolves the user")
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	state := start.State
	for i := 0; i < 50; i++ {
		action := "register"
		if state.CurrentStep == "register" {
			action = "sign_in"
		}
		result, err := w.sm.Process(t.Context(), def, state, domain.FlowSubmitInput{Action: action})
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

// ssoSchemaContent is the schema behind [ssoRenderWorld]: email and username
// are project-unique, so the collision check probes them; badge is
// team-unique, which the probe skips; age is a type union no step renders.
const ssoSchemaContent string = `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"x-auth-methods": { "password": { "enabled": true }, "passkey": { "enabled": true } },
		"x-identifier": "email",
		"required": ["email", "username", "given_name", "family_name", "badge"],
		"properties": {
			"email":       { "type": "string", "format": "email", "maxLength": 320, "x-unique": "project" },
			"username":    { "type": "string", "minLength": 3, "maxLength": 64, "x-unique": "project" },
			"given_name":  { "type": "string", "minLength": 1, "maxLength": 200 },
			"family_name": { "type": "string", "minLength": 1, "maxLength": 200 },
			"badge":       { "type": "string", "x-unique": "team" },
			"age":         { "type": ["string", "integer"] }
		}
	}`

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

	require.Len(t, start.Step.Fields, 1)
	assert.Equal(t, "email", start.Step.Fields[0].Name)
	assert.Equal(t, domain.AutocompleteUsername, start.Step.Fields[0].Autocomplete)
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

	require.NotNil(t, result.Step.Identifier)
	assert.Equal(t, email, result.Step.Identifier.Value)
	assert.Equal(t, domain.AutocompleteUsername, result.Step.Identifier.Autocomplete)

	// Render-only: submitting it back would re-resolve the identifier.
	assert.False(t, containsFieldName(result.Step.Fields, "email"))
}

// The case a client cannot cover for itself: the widget keeps collected
// values in memory only, while GET /flow/{id} re-renders from flow state.
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	advanced, err := w.sm.Process(t.Context(), def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
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

	start, err := w.sm.Start(t.Context(), domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
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
}

// ssoRenderWorld is a test world sitting on the sso step of
// [ssoStepDefinition], with the schema and the provider list resolving on
// every render.
func ssoRenderWorld(t *testing.T) (*flowTestWorld, *domain.FlowDefinition, *domain.FlowState) {
	t.Helper()
	return ssoRenderWorldWithSchema(t, ssoSchemaContent)
}

// ssoRenderWorldWithSchema is [ssoRenderWorld] on another user schema.
func ssoRenderWorldWithSchema(t *testing.T, schema string) (*flowTestWorld, *domain.FlowDefinition, *domain.FlowState) {
	t.Helper()
	w := newFlowTestWorld(t)
	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, schema), nil).
		AnyTimes()
	w.ssoProviders.EXPECT().
		Resolve(gomock.Any(), testProjectID, "credentials", gomock.Any()).
		Return([]domain.FlowSSOProvider{{ID: "google", Name: "Google"}}, nil).
		AnyTimes()
	state := &domain.FlowState{
		ID:            "flow-1",
		ProjectID:     testProjectID,
		UserSchemaURL: defaultSchemaURL,
		FlowProgress: domain.FlowProgress{
			DefinitionID:   "def-signup",
			Purpose:        domain.FlowDefinitionPurposeRegister,
			CurrentPurpose: domain.FlowDefinitionPurposeRegister,
			CurrentStep:    "credentials",
		},
		AuthAttemptID: "att-1",
	}
	return w, ssoStepDefinition(), state
}

// expectParked makes LoadParked hand back parked for the world's attempt.
func (w *flowTestWorld) expectParked(parked *domain.FlowSSOParkedIdentity, err error) {
	w.ssoIdentities.EXPECT().
		LoadParked(gomock.Any(), domain.FlowSSOLoadInput{
			ProjectID:     testProjectID,
			AttemptID:     "att-1",
			UserSchemaURL: defaultSchemaURL,
		}).
		Return(parked, err)
}

func linkedParked() *domain.FlowSSOParkedIdentity {
	return &domain.FlowSSOParkedIdentity{
		CheckID:      "ch-1",
		ConnectionID: "idp-1",
		Subject:      "sub-1",
		Link:         &domain.FlowSSOLinkedUser{LinkID: "idplink-1", UserID: "user-1"},
	}
}

func TestFlowStateMachine_Render_SSOReplayGuardSkipsResolution(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	state.SSOResolvedCheckID = "ch-1"
	// The engine hands its guard to the service, which skips the resolved row.
	w.ssoIdentities.EXPECT().
		LoadParked(gomock.Any(), domain.FlowSSOLoadInput{
			ProjectID:       testProjectID,
			AttemptID:       "att-1",
			UserSchemaURL:   defaultSchemaURL,
			ResolvedCheckID: "ch-1",
		}).
		Return(nil, nil)
	w.ssoIdentities.EXPECT().BindLinked(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	assert.Nil(t, result.Step.Error)
	assert.Empty(t, result.State.CollectedData.UserID)
	assert.Empty(t, result.HandoffToken)
	assert.False(t, result.Reseal)
}

func TestFlowStateMachine_Render_NoParkedIdentityRendersStep(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	w.expectParked(nil, nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	assert.Nil(t, result.Step.Error)
	assert.Empty(t, result.State.SSOResolvedCheckID)
	assert.False(t, result.Reseal)
	assert.Zero(t, result.State.IssuedAt, "a plain render does not refresh IssuedAt")
}

func TestFlowStateMachine_Render_SSORestartRequiredPropagates(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	w.expectParked(nil, domain.ErrFlowRestartRequired())

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

// The attempt read on every render also ends a flow whose attempt is dead,
// on a step that offers no sso_providers too.
func TestFlowStateMachine_Render_DeadAttemptRestartsStepWithoutSSO(t *testing.T) {
	t.Parallel()
	w, _, state := ssoRenderWorld(t)
	w.expectParked(nil, domain.ErrFlowRestartRequired())

	_, err := w.sm.Render(t.Context(), signupDefinition(), state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

func TestFlowStateMachine_Render_SSOCreationDisabledRendersStepError(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	w.expectParked(&domain.FlowSSOParkedIdentity{CheckID: "ch-1", ConnectionID: "idp-1", Subject: "sub-1", CreationDisabled: true}, nil)
	w.ssoIdentities.EXPECT().BindLinked(gomock.Any(), gomock.Any()).Times(0)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	require.NotNil(t, result.Step.Error)
	assert.Equal(t, domain.FlowStepErrorSSOCreationDisabled, *result.Step.Error)
	assert.True(t, containsFieldName(result.Step.Fields, "email"), "the step keeps its inputs")
	assert.Empty(t, result.HandoffToken)
	assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID)
	assert.True(t, result.Reseal)
}

func TestFlowStateMachine_Render_SSOParkedErrorRendersStepError(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	w.expectParked(&domain.FlowSSOParkedIdentity{CheckID: "ch-1", ErrorKey: domain.FlowStepErrorSSOCancelled}, nil)
	w.ssoIdentities.EXPECT().BindLinked(gomock.Any(), gomock.Any()).Times(0)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	require.NotNil(t, result.Step.Error)
	assert.Equal(t, domain.FlowStepErrorSSOCancelled, *result.Step.Error)
	assert.True(t, containsFieldName(result.Step.Fields, "email"), "the step keeps its inputs")
	assert.Empty(t, result.HandoffToken)
	assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID)
	assert.True(t, result.Reseal)
}

// unlinkedParked is an identity with no link under `creation: auto`.
func unlinkedParked(claims map[string]any, verified map[string]bool) *domain.FlowSSOParkedIdentity {
	return &domain.FlowSSOParkedIdentity{CheckID: "ch-1", ConnectionID: "idp-1", Subject: "sub-1", Claims: claims, Verified: verified}
}

// completeClaims carries every required property of ssoSchemaContent, the
// x-unique ones verified.
func completeClaims() (map[string]any, map[string]bool) {
	return map[string]any{
			"email":       "alice@example.com",
			"username":    "alice",
			"given_name":  "Alice",
			"family_name": "Liddell",
			"badge":       "b-7",
		}, map[string]bool{
			"email":    true,
			"username": true,
			"badge":    true,
		}
}

// withSSOOutcomeSteps routes the two creation outcomes to their own steps.
func withSSOOutcomeSteps(def *domain.FlowDefinition) *domain.FlowDefinition {
	def.Steps[0].Transitions[domain.FlowImplicitOutcomeUserAlreadyExists] = domain.FlowStepTransition{Target: "sso-conflict"}
	def.Steps[0].Transitions[domain.FlowImplicitOutcomeSSOUserNotFound] = domain.FlowStepTransition{Target: "sso-register"}
	def.Steps = append(def.Steps,
		domain.FlowDefinitionStep{Name: "sso-conflict", Fields: []domain.Field{"email"}},
		domain.FlowDefinitionStep{Name: "sso-register", Fields: []domain.Field{"email", "username"}},
	)
	return def
}

// expectOwner answers one read-only collision lookup; "" is no owner.
func (w *flowTestWorld) expectOwner(attribute, value, userID string) *domainmock.MockFlowSSOIdentityServiceFindUniqueOwnerCall {
	return w.ssoIdentities.EXPECT().
		FindUniqueOwner(gomock.Any(), testProjectID, defaultSchemaURL, attribute, value).
		Return(userID, nil)
}

// expectBindCollision answers the bind of a found owner by user id.
func (w *flowTestWorld) expectBindCollision(userID string, err error) *domainmock.MockFlowSSOIdentityServiceBindCollisionCall {
	return w.ssoIdentities.EXPECT().
		BindCollision(gomock.Any(), domain.FlowSSOBindInput{ProjectID: testProjectID, AttemptID: "att-1", CheckID: "ch-1", UserID: userID}).
		Return(err)
}

func TestFlowStateMachine_Render_SSOCollisionRoutesUserAlreadyExists(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com", "username": "alice"}, map[string]bool{"email": true}), nil)
	gomock.InOrder(
		w.expectOwner("email", "alice@example.com", ""),
		w.expectOwner("username", "alice", "user-9"),
		w.expectBindCollision("user-9", nil),
	)
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)
	w.ssoIdentities.EXPECT().BindLinked(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-conflict", result.Step.Name)
	assert.Equal(t, "user-9", result.State.CollectedData.UserID)
	assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID)
	assert.True(t, result.Reseal)
}

func TestFlowStateMachine_Render_SSOCollisionFlipsRegisterToLogin(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	require.Equal(t, domain.FlowDefinitionPurposeRegister, state.CurrentPurpose)
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.expectOwner("email", "alice@example.com", "user-9")
	w.expectBindCollision("user-9", nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, result.State.CurrentPurpose)
}

// The attempt already carries another user, or it expired or was handed off:
// the bind refuses, and the flow starts over.
func TestFlowStateMachine_Render_SSOCollisionBindOnDeadAttemptRestarts(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.expectOwner("email", "alice@example.com", "user-9")
	w.expectBindCollision("user-9", domain.ErrFlowRestartRequired())
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
	assert.Empty(t, state.CollectedData.UserID)
}

// The claim belongs to a user of another schema: the flow cannot continue
// with that user, so it starts over without binding or creating anyone.
func TestFlowStateMachine_Render_SSOCollisionOwnerOfAnotherSchemaRestarts(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.ssoIdentities.EXPECT().
		FindUniqueOwner(gomock.Any(), testProjectID, defaultSchemaURL, "email", "alice@example.com").
		Return("", domain.ErrFlowRestartRequired())
	w.ssoIdentities.EXPECT().BindCollision(gomock.Any(), gomock.Any()).Times(0)
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
	assert.Empty(t, state.CollectedData.UserID)
}

// A provider claim that fails the schema (too long, bad format) cannot create
// a user unattended, so it is collected for the user to fix.
func TestFlowStateMachine_Render_SSOInvalidClaimRoutesUserNotFound(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	claims, verified := completeClaims()
	w.expectParked(unlinkedParked(claims, verified), nil)
	w.ssoIdentities.EXPECT().FindUniqueOwner(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return("", nil).Times(2)
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Return("", domain.ErrUserInvalid())

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-register", result.Step.Name)
	assert.Empty(t, result.State.CollectedData.UserID)
	assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID)
}

func TestFlowStateMachine_Render_SSOAutoCreateRoutesAuthenticated(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	claims, verified := completeClaims()
	w.expectParked(unlinkedParked(claims, verified), nil)
	w.expectOwner("email", "alice@example.com", "")
	w.expectOwner("username", "alice", "")
	w.ssoIdentities.EXPECT().
		CreateLinked(gomock.Any(), domain.FlowSSOCreateInput{
			ProjectID:     testProjectID,
			AttemptID:     "att-1",
			CheckID:       "ch-1",
			UserSchemaURL: defaultSchemaURL,
			ConnectionID:  "idp-1",
			Subject:       "sub-1",
			Attributes:    claims,
		}).
		Return("user-new", nil)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), domain.FlowHandoffInput{ProjectID: testProjectID, AttemptID: "att-1"}).
		Return(domain.FlowHandoffOutput{Token: "handoff-1", ExpiresAt: time.Unix(1700000060, 0).UTC()}, nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	require.Equal(t, "done", result.Step.Name)
	assert.Equal(t, "handoff-1", result.HandoffToken)
	assert.Equal(t, "user-new", result.State.CollectedData.UserID)
	assert.True(t, result.Reseal)
}

// As after create_user, the step that created the user offers no back, even
// when sso_authenticated leads to a non-terminal step.
func TestFlowStateMachine_Render_SSOAutoCreateClearsBackStack(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def.Steps[0].Transitions[domain.FlowImplicitOutcomeSSOAuthenticated] = domain.FlowStepTransition{Target: "enroll"}
	def.Steps = append(def.Steps, domain.FlowDefinitionStep{Name: "enroll", Fields: []domain.Field{"email"}})
	claims, verified := completeClaims()
	w.expectParked(unlinkedParked(claims, verified), nil)
	w.ssoIdentities.EXPECT().FindUniqueOwner(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return("", nil).Times(2)
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Return("user-new", nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	require.Equal(t, "enroll", result.Step.Name)
	assert.Equal(t, "user-new", result.State.CollectedData.UserID)
	assert.Empty(t, result.State.BackStack)
}

// Complete claims on a step that cannot route sso_authenticated create
// nothing: the step shows the provider as unavailable, and the row stays
// parked.
func TestFlowStateMachine_Render_SSOUnroutableTransitionDoesNotCreate(t *testing.T) {
	t.Parallel()
	for name, transition := range unroutableSSOTransitions() {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			setSSOAuthenticatedTransition(def, transition)
			claims, verified := completeClaims()
			w.expectParked(unlinkedParked(claims, verified), nil)
			w.expectOwner("email", "alice@example.com", "")
			w.expectOwner("username", "alice", "")
			w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, "credentials", result.Step.Name)
			require.NotNil(t, result.Step.Error)
			assert.Equal(t, domain.FlowStepErrorSSOUnavailable, *result.Step.Error)
			assert.Empty(t, result.State.CollectedData.UserID)
			assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID)
			assert.True(t, result.Reseal)
		})
	}
}

// Another sign-in took a unique attribute between the probe and the insert:
// the probe runs once more and binds the winner.
func TestFlowStateMachine_Render_SSOCreateUniqueRaceFallsThroughToCollision(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	claims, verified := completeClaims()
	w.expectParked(unlinkedParked(claims, verified), nil)
	gomock.InOrder(
		w.expectOwner("email", "alice@example.com", ""),
		w.expectOwner("username", "alice", ""),
		w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Return("", domain.ErrUserAlreadyExists()),
		w.expectOwner("email", "alice@example.com", "user-9"),
		w.expectBindCollision("user-9", nil),
	)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-conflict", result.Step.Name)
	assert.Equal(t, "user-9", result.State.CollectedData.UserID)
}

// The race was lost on the subject (or the owner went away again): no
// candidate binds, so the identity falls back to collection.
func TestFlowStateMachine_Render_SSOCreateUniqueRaceWithoutOwnerRoutesUserNotFound(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	claims, verified := completeClaims()
	w.expectParked(unlinkedParked(claims, verified), nil)
	w.ssoIdentities.EXPECT().FindUniqueOwner(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return("", nil).Times(4)
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Return("", domain.ErrUserAlreadyExists())

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-register", result.Step.Name)
	assert.Empty(t, result.State.CollectedData.UserID)
}

// Collection is the fallback: nothing is created, the parked row stays for
// the registration step to prefill from, and login flips to register.
func TestFlowStateMachine_Render_SSOMissingRequiredRoutesUserNotFound(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	state.CurrentPurpose = domain.FlowDefinitionPurposeLogin
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, map[string]bool{"email": true}), nil)
	w.expectOwner("email", "alice@example.com", "")
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-register", result.Step.Name)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, result.State.CurrentPurpose)
	assert.Empty(t, result.State.CollectedData.UserID)
	assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID, "the row stays, so the guard keeps it from resolving again")
	assert.True(t, result.Reseal, "the guard reaches the cookie only through a re-seal")
}

// A required unique claim the provider did not verify could take over
// someone's address, so it is collected instead of trusted.
func TestFlowStateMachine_Render_SSOUnverifiedRequiredUniqueRoutesUserNotFound(t *testing.T) {
	t.Parallel()
	// The rule holds for every scope, including a team scope the collision
	// check does not probe.
	for _, unverified := range []string{"email", "badge"} {
		t.Run(unverified, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			def = withSSOOutcomeSteps(def)
			claims, verified := completeClaims()
			verified[unverified] = false
			w.expectParked(unlinkedParked(claims, verified), nil)
			w.expectOwner("email", "alice@example.com", "")
			w.expectOwner("username", "alice", "")
			w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, "sso-register", result.Step.Name)
		})
	}
}

// The identifier lookup is not scoped to a team, so probing a team-unique
// claim could bind a user of another team. The claim is not probed; a real
// collision in the new user's scope is refused by the create instead.
func TestFlowStateMachine_Render_SSOTeamScopedUniqueClaimIsNotProbed(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	claims, verified := completeClaims()
	w.expectParked(unlinkedParked(claims, verified), nil)
	w.ssoIdentities.EXPECT().
		FindUniqueOwner(gomock.Any(), testProjectID, defaultSchemaURL, gomock.Cond(func(attribute string) bool { return attribute != "badge" }), gomock.Any()).
		Return("", nil).
		Times(4)
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Return("", domain.ErrUserAlreadyExists())

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-register", result.Step.Name)
	assert.Empty(t, result.State.CollectedData.UserID, "no user of another team is bound")
}

// A step that does not route the outcome re-renders with the outcome as its
// error, as a handler diversion does.
func TestFlowStateMachine_Render_SSOOutcomeUnwiredRendersOutcomeToken(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.expectOwner("email", "alice@example.com", "")

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	require.NotNil(t, result.Step.Error)
	assert.Equal(t, domain.FlowImplicitOutcomeSSOUserNotFound, *result.Step.Error)
	assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID)
}

// The validator does not require user_already_exists on a step that offers
// sso_providers. Without a usable one, the owner the probe found is not
// bound: the step shows the provider as unavailable, the row stays parked,
// and the guard keeps a reload from repeating it.
func TestFlowStateMachine_Render_SSOCollisionUnroutableDoesNotBind(t *testing.T) {
	t.Parallel()
	action := domain.Switch
	for name, transition := range map[string]*domain.FlowStepTransition{
		"missing":     nil,
		"with action": {Target: "other-flow", Action: &action},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			if transition != nil {
				def.Steps[0].Transitions[domain.FlowImplicitOutcomeUserAlreadyExists] = *transition
			}
			w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
			w.expectOwner("email", "alice@example.com", "user-9")
			w.ssoIdentities.EXPECT().BindCollision(gomock.Any(), gomock.Any()).Times(0)
			w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, "credentials", result.Step.Name)
			require.NotNil(t, result.Step.Error)
			assert.Equal(t, domain.FlowStepErrorSSOUnavailable, *result.Step.Error)
			assert.Empty(t, result.State.CollectedData.UserID)
			assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID)
		})
	}
}

// A purpose on user_already_exists starts that purpose fresh, as it does for
// a typed collision: the bound user is dropped with a new attempt, and the
// flow continues on the purpose's entry step instead of getting stuck.
func TestFlowStateMachine_Render_SSOCollisionWithPurposeStartsThatPurposeFresh(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	register := domain.FlowDefinitionPurposeRegister
	def.Steps[0].Transitions[domain.FlowImplicitOutcomeUserAlreadyExists] = domain.FlowStepTransition{Target: "credentials", Purpose: &register}
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.expectOwner("email", "alice@example.com", "user-9")
	w.expectBindCollision("user-9", nil)
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("att-2", nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	assert.Nil(t, result.Step.Error)
	assert.Empty(t, result.State.CollectedData.UserID)
	assert.Equal(t, "att-2", result.State.AuthAttemptID)
}

// unroutableSSOTransitions are sso_authenticated transitions a stored
// definition can carry but the engine cannot take with the bound user, keyed
// by case name. nil removes the transition.
func unroutableSSOTransitions() map[string]*domain.FlowStepTransition {
	register := domain.FlowDefinitionPurposeRegister
	action := domain.Switch
	return map[string]*domain.FlowStepTransition{
		"missing":      nil,
		"with purpose": {Target: "done", Purpose: &register},
		"with action":  {Target: "other-flow", Action: &action},
	}
}

func setSSOAuthenticatedTransition(def *domain.FlowDefinition, transition *domain.FlowStepTransition) {
	delete(def.Steps[0].Transitions, domain.FlowImplicitOutcomeSSOAuthenticated)
	if transition != nil {
		def.Steps[0].Transitions[domain.FlowImplicitOutcomeSSOAuthenticated] = *transition
	}
}

// A stored definition is validated only on write. When its sso_authenticated
// transition cannot route, the attempt is not bound: the step shows the
// provider as unavailable, and the guard keeps a reload from repeating it.
func TestFlowStateMachine_Render_SSOUnroutableTransitionDoesNotBind(t *testing.T) {
	t.Parallel()
	for name, transition := range unroutableSSOTransitions() {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			setSSOAuthenticatedTransition(def, transition)
			w.expectParked(linkedParked(), nil)
			w.ssoIdentities.EXPECT().BindLinked(gomock.Any(), gomock.Any()).Times(0)
			w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, "credentials", result.Step.Name)
			require.NotNil(t, result.Step.Error)
			assert.Equal(t, domain.FlowStepErrorSSOUnavailable, *result.Step.Error)
			assert.Empty(t, result.State.CollectedData.UserID)
			assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID)
		})
	}
}

// An earlier bind committed but the current step cannot take the outcome: the
// step shows the provider as unavailable, and the attempt keeps its id and its
// user.
func TestFlowStateMachine_Render_SSOUnroutableTransitionDoesNotRetryHandoff(t *testing.T) {
	t.Parallel()
	for name, transition := range unroutableSSOTransitions() {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			setSSOAuthenticatedTransition(def, transition)
			w.expectParked(&domain.FlowSSOParkedIdentity{BoundUserID: "user-1"}, nil)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, "credentials", result.Step.Name)
			require.NotNil(t, result.Step.Error)
			assert.Equal(t, domain.FlowStepErrorSSOUnavailable, *result.Step.Error)
			assert.Empty(t, result.State.CollectedData.UserID)
			assert.Equal(t, "att-1", result.State.AuthAttemptID)
			assert.False(t, result.Reseal)
		})
	}
}

func TestFlowStateMachine_Render_SSOBindOnForeignUserRestarts(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	w.expectParked(linkedParked(), nil)
	w.ssoIdentities.EXPECT().BindLinked(gomock.Any(), gomock.Any()).Return(domain.ErrFlowRestartRequired())
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
	assert.Empty(t, state.CollectedData.UserID, "nothing is recorded for the foreign user")
	assert.Equal(t, "credentials", state.CurrentStep)
}

func TestFlowStateMachine_Render_SSOBoundAttemptWithRecordedUserRendersStep(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	state.CollectedData.UserID = "u1"
	w.expectParked(&domain.FlowSSOParkedIdentity{BoundUserID: "u1"}, nil)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	assert.Empty(t, result.HandoffToken)
}

// expectStaleBind makes the bind of linkedParked find its row gone, and the
// second read of the attempt hand back parked.
func (w *flowTestWorld) expectStaleBind(parked *domain.FlowSSOParkedIdentity, err error) {
	w.expectParked(linkedParked(), nil)
	w.ssoIdentities.EXPECT().BindLinked(gomock.Any(), gomock.Any()).Return(domain.ErrSSOStateInvalid())
	w.expectParked(parked, err)
}

// The winner settled the row and handed off: this response must not reseal a
// cookie over the winner's.
func TestFlowStateMachine_Render_SSOStaleBindAfterHandoffRestarts(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	w.expectStaleBind(nil, domain.ErrFlowRestartRequired())
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

// A new ceremony replaced the row: the step renders, so the flow and its
// cookie stay usable for that ceremony.
func TestFlowStateMachine_Render_SSOStaleBindOnReplacedRowRendersStep(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	w.expectStaleBind(nil, nil)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	assert.Nil(t, result.Step.Error)
	assert.Empty(t, result.State.CollectedData.UserID)
	assert.Empty(t, result.HandoffToken)
}

// Under creation auto the create's own delete can find the row gone. A row a
// new ceremony replaced shows the step with no outcome and records no user.
// The collision case is TestFlowStateMachine_Render_SSOCollisionStaleRowBindsNothing.
func TestFlowStateMachine_Render_SSOStaleParkedRowProvisioningRendersStep(t *testing.T) {
	t.Parallel()
	for name, wire := range map[string]func(w *flowTestWorld){
		"create": func(w *flowTestWorld) {
			claims, verified := completeClaims()
			w.expectParked(unlinkedParked(claims, verified), nil)
			w.ssoIdentities.EXPECT().FindUniqueOwner(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return("", nil).Times(2)
			w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Return("", domain.ErrSSOStateInvalid())
			w.expectParked(nil, nil)
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			def = withSSOOutcomeSteps(def)
			wire(w)
			w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, "credentials", result.Step.Name)
			assert.Nil(t, result.Step.Error)
			assert.Empty(t, result.State.CollectedData.UserID)
			assert.False(t, result.Reseal)
		})
	}
}

// ssoHandoffPaths are the ways a render reaches the handoff: its own bind or
// creation, or a bind an earlier request committed.
var ssoHandoffPaths = []struct {
	name        string
	expect      func(w *flowTestWorld)
	wantCheckID string
}{
	{
		name: "own bind",
		expect: func(w *flowTestWorld) {
			w.expectParked(linkedParked(), nil)
			w.ssoIdentities.EXPECT().
				BindLinked(gomock.Any(), domain.FlowSSOBindInput{
					ProjectID:    testProjectID,
					AttemptID:    "att-1",
					CheckID:      "ch-1",
					UserID:       "user-1",
					ConnectionID: "idp-1",
					LinkID:       "idplink-1",
				}).
				Return(nil)
		},
		wantCheckID: "ch-1",
	},
	{
		name: "own creation",
		expect: func(w *flowTestWorld) {
			claims, verified := completeClaims()
			w.expectParked(unlinkedParked(claims, verified), nil)
			w.expectOwner("email", "alice@example.com", "")
			w.expectOwner("username", "alice", "")
			w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Return("user-1", nil)
		},
		wantCheckID: "ch-1",
	},
	{
		name: "earlier bind",
		expect: func(w *flowTestWorld) {
			w.expectParked(&domain.FlowSSOParkedIdentity{BoundUserID: "user-1"}, nil)
		},
	},
	{
		name: "stale bind",
		expect: func(w *flowTestWorld) {
			w.expectStaleBind(&domain.FlowSSOParkedIdentity{BoundUserID: "user-1"}, nil)
		},
		wantCheckID: "ch-1",
	},
}

// Every path mints the handoff on this render, so a lost earlier response
// still signs the user in.
func TestFlowStateMachine_Render_SSOHandoff(t *testing.T) {
	t.Parallel()
	for _, tt := range ssoHandoffPaths {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			tt.expect(w)
			w.authAttemptService.EXPECT().
				Handoff(gomock.Any(), domain.FlowHandoffInput{ProjectID: testProjectID, AttemptID: "att-1"}).
				Return(domain.FlowHandoffOutput{Token: "handoff-1", ExpiresAt: time.Unix(1700000060, 0).UTC()}, nil)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			require.Equal(t, "done", result.Step.Name)
			require.NotNil(t, result.Step.Complete)
			assert.Equal(t, "handoff-1", result.HandoffToken)
			assert.Equal(t, "user-1", result.State.CollectedData.UserID)
			assert.Equal(t, tt.wantCheckID, result.State.SSOResolvedCheckID)
		})
	}
}

// The bind deletes the exact row first, so a row another request replaced
// binds nothing on the attempt.
func TestFlowStateMachine_Render_SSOCollisionStaleRowBindsNothing(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.expectOwner("email", "alice@example.com", "user-9")
	w.expectBindCollision("user-9", domain.ErrSSOStateInvalid())
	w.expectParked(nil, nil)
	w.authAttemptService.EXPECT().SubmitIdentifier(gomock.Any(), gomock.Any()).Times(0)
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	assert.Nil(t, result.Step.Error)
	assert.Empty(t, result.State.CollectedData.UserID)
}

// A concurrent request created the user from the same identity and bound the
// attempt, so this collision bind finds the row gone: it retries that
// request's handoff instead of resealing a stale cookie.
func TestFlowStateMachine_Render_SSOCollisionStaleRowAfterCreationRetriesHandoff(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.expectOwner("email", "alice@example.com", "user-9")
	w.expectBindCollision("user-9", domain.ErrSSOStateInvalid())
	w.expectParked(&domain.FlowSSOParkedIdentity{BoundUserID: "user-9"}, nil)
	w.authAttemptService.EXPECT().
		Handoff(gomock.Any(), domain.FlowHandoffInput{ProjectID: testProjectID, AttemptID: "att-1"}).
		Return(domain.FlowHandoffOutput{Token: "handoff-1", ExpiresAt: time.Unix(1700000060, 0).UTC()}, nil).
		Times(1)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "done", result.Step.Name)
	assert.Equal(t, "handoff-1", result.HandoffToken)
	assert.Equal(t, "user-9", result.State.CollectedData.UserID)
}

// still a valid claim: resolution reads x-unique directly and goes on.
func TestFlowStateMachine_Render_SSOUnionTypedClaimDoesNotFailResolution(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com", "age": 42}, nil), nil)
	w.expectOwner("email", "alice@example.com", "")

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-register", result.Step.Name)
}

// A lookup miss is not a sign-in attempt: no identifier proof is submitted,
// so the attempt records no failed check.
func TestFlowStateMachine_Render_SSOCollisionProbeMissesRecordNoProof(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	claims, verified := completeClaims()
	verified["email"] = false
	w.expectParked(unlinkedParked(claims, verified), nil)
	w.expectOwner("email", "alice@example.com", "")
	w.expectOwner("username", "alice", "")
	w.authAttemptService.EXPECT().SubmitIdentifier(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-register", result.Step.Name)
}

// A concurrent render won the handoff: the attempt is handed off, so this one
// restarts, as every later render of this cookie would.
func TestFlowStateMachine_Render_SSOHandoffLostRace(t *testing.T) {
	t.Parallel()
	for _, tt := range ssoHandoffPaths {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			tt.expect(w)
			w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).
				Return(domain.FlowHandoffOutput{}, domain.ErrAuthAttemptAlreadyHandedOff())

			_, err := w.sm.Render(t.Context(), def, state)
			require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
			assert.ErrorIs(t, err, domain.ErrAuthAttemptAlreadyHandedOff())
		})
	}
}

// A completed flow has handed its attempt off (and the session exchange may
// have deleted it), so a render on the terminal step reads nothing.
func TestFlowStateMachine_Render_TerminalStepSkipsResolution(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	state.CurrentStep = "done"
	w.ssoIdentities.EXPECT().LoadParked(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "done", result.Step.Name)
	// Marked complete, so GET /flow/{id} can answer 410 for a finished flow.
	assert.NotNil(t, result.Step.Complete)
}

// A top-level property whose name has a dot would be stored as a nested
// object, so its claim is collected instead of created.
func TestFlowStateMachine_Render_SSODottedPropertyFallsBackToCollection(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorldWithSchema(t, `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"x-auth-methods": { "password": { "enabled": true } },
		"x-identifier": "email",
		"required": ["email"],
		"properties": {
			"email":     { "type": "string", "format": "email", "x-unique": "project" },
			"username":  { "type": "string" },
			"home.city": { "type": "string" }
		}
	}`)
	def = withSSOOutcomeSteps(def)
	w.expectParked(unlinkedParked(
		map[string]any{"email": "alice@example.com", "home.city": "Oxford"},
		map[string]bool{"email": true},
	), nil)
	w.expectOwner("email", "alice@example.com", "")
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-register", result.Step.Name)
}

// The attempt already carries another user: binding the owner would replace
// it, so the flow starts over and nothing is written.
func TestFlowStateMachine_Render_SSOCollisionOnAttemptBoundToOtherUserRestarts(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	state.CollectedData.UserID = "u-a"
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.expectOwner("email", "alice@example.com", "u-b")
	w.ssoIdentities.EXPECT().BindCollision(gomock.Any(), gomock.Any()).Times(0)
	w.authAttemptService.EXPECT().SubmitIdentifier(gomock.Any(), gomock.Any()).Times(0)

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
	assert.Equal(t, "u-a", state.CollectedData.UserID)
}

// The attempt already carries the owner, so there is nothing to probe: the
// row is settled and the collision outcome raised.
func TestFlowStateMachine_Render_SSOCollisionOnAttemptBoundToSameUserBindsWithoutProbe(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	state.CollectedData.UserID = "u-b"
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.expectOwner("email", "alice@example.com", "u-b")
	w.expectBindCollision("u-b", nil)
	w.authAttemptService.EXPECT().SubmitIdentifier(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-conflict", result.Step.Name)
	assert.Equal(t, "u-b", result.State.CollectedData.UserID)
}

// An identity that neither links to nor collides with the user the flow
// already carries cannot register a new user on that attempt.
func TestFlowStateMachine_Render_SSOUnlinkedIdentityOnBoundAttemptRestarts(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	state.CollectedData.UserID = "u-a"
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, nil), nil)
	w.expectOwner("email", "alice@example.com", "")
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
	assert.Equal(t, "u-a", state.CollectedData.UserID)
}

// Composed requiredness (allOf, if/then, dependentRequired, ...) is not
// evaluated, so a schema that uses it cannot create a user unattended: an
// unverified unique claim could otherwise become required unseen.
func TestFlowStateMachine_Render_SSOComposedRequiredSchemaFallsBackToCollection(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorldWithSchema(t, `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"x-auth-methods": { "password": { "enabled": true } },
		"x-identifier": "email",
		"properties": {
			"email":    { "type": "string", "format": "email", "x-unique": "project" },
			"username": { "type": "string" }
		},
		"allOf": [ { "required": ["email"] } ]
	}`)
	def = withSSOOutcomeSteps(def)
	w.expectParked(unlinkedParked(map[string]any{"email": "alice@example.com"}, map[string]bool{"email": false}), nil)
	w.expectOwner("email", "alice@example.com", "")
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-register", result.Step.Name)
}

// The collision keeps the parked row. When the sealed cookie from the first
// render is lost, the client renders again with its earlier state (no user,
// no guard): the same owner is bound again and the outcome raised again.
func TestFlowStateMachine_Render_SSOCollisionRetryAfterLostCookieRaisesAgain(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	lost := *state
	parked := unlinkedParked(map[string]any{"email": "alice@example.com"}, nil)
	w.expectParked(parked, nil)
	w.expectParked(parked, nil)
	w.expectOwner("email", "alice@example.com", "user-9").Times(2)
	w.expectBindCollision("user-9", nil).Times(2)

	first, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	require.Equal(t, "sso-conflict", first.Step.Name)

	retry, err := w.sm.Render(t.Context(), def, &lost)
	require.NoError(t, err)
	assert.Equal(t, "sso-conflict", retry.Step.Name)
	assert.Equal(t, "user-9", retry.State.CollectedData.UserID)
}

// A connection can map a superset of properties for several schemas; each
// schema consumes only the properties it defines, so the rest is not stored.
// A dotted key the schema does not define is ignored the same way.
func TestFlowStateMachine_Render_SSOUnknownClaimIsNotPersisted(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	claims, verified := completeClaims()
	withUnknown := maps.Clone(claims)
	withUnknown["nickname"] = "ali"
	withUnknown["address.city"] = "Oxford"
	w.expectParked(unlinkedParked(withUnknown, verified), nil)
	w.ssoIdentities.EXPECT().FindUniqueOwner(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return("", nil).Times(2)
	w.ssoIdentities.EXPECT().
		CreateLinked(gomock.Any(), gomock.Cond(func(in domain.FlowSSOCreateInput) bool {
			return assert.ObjectsAreEqual(claims, in.Attributes)
		})).
		Return("user-new", nil)
	w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).
		Return(domain.FlowHandoffOutput{Token: "handoff-1", ExpiresAt: time.Unix(1700000060, 0).UTC()}, nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "done", result.Step.Name)
}

// Composition below the root counts too: a required object whose own
// subschema makes a unique leaf required is not evaluated either, and a $ref
// can point anywhere. Both fall back to collection.
func TestFlowStateMachine_Render_SSONestedComposedRequiredFallsBackToCollection(t *testing.T) {
	t.Parallel()
	for name, schema := range map[string]string{
		"nested allOf": `{
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			"type": "object",
			"x-auth-methods": { "password": { "enabled": true } },
			"x-identifier": "email",
			"required": ["email", "address"],
			"properties": {
				"email":    { "type": "string", "format": "email", "x-unique": "project" },
				"username": { "type": "string" },
				"address":  {
					"type": "object",
					"properties": { "email": { "type": "string", "x-unique": "project" } },
					"allOf": [ { "required": ["email"] } ]
				}
			}
		}`,
		"double not": `{
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			"type": "object",
			"x-auth-methods": { "password": { "enabled": true } },
			"x-identifier": "email",
			"required": ["email", "address"],
			"properties": {
				"email":    { "type": "string", "format": "email", "x-unique": "project" },
				"username": { "type": "string" },
				"address":  {
					"type": "object",
					"properties": { "email": { "type": "string", "x-unique": "project" } },
					"not": { "not": { "required": ["email"] } }
				}
			}
		}`,
		"ref": `{
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			"type": "object",
			"x-auth-methods": { "password": { "enabled": true } },
			"x-identifier": "email",
			"required": ["email", "address"],
			"$defs": { "address": { "type": "object", "properties": { "email": { "type": "string" } } } },
			"properties": {
				"email":    { "type": "string", "format": "email", "x-unique": "project" },
				"username": { "type": "string" },
				"address":  { "$ref": "#/$defs/address" }
			}
		}`,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorldWithSchema(t, schema)
			def = withSSOOutcomeSteps(def)
			w.expectParked(unlinkedParked(
				map[string]any{"email": "alice@example.com", "address": map[string]any{"email": "home@example.com"}},
				map[string]bool{"email": true},
			), nil)
			w.expectOwner("email", "alice@example.com", "")
			w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, "sso-register", result.Step.Name)
		})
	}
}

// An array can carry x-unique and is stored in the uniqueness registry, so a
// required unique array must arrive verified like any other unique property.
// It is not probed: the collision lookup takes a single string value.
func TestFlowStateMachine_Render_SSOUnverifiedRequiredUniqueArrayFallsBackToCollection(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorldWithSchema(t, `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"x-auth-methods": { "password": { "enabled": true } },
		"x-identifier": "email",
		"required": ["email", "aliases"],
		"properties": {
			"email":    { "type": "string", "format": "email", "x-unique": "project" },
			"username": { "type": "string" },
			"aliases":  { "type": "array", "items": { "type": "string" }, "x-unique": "project" }
		}
	}`)
	def = withSSOOutcomeSteps(def)
	w.expectParked(unlinkedParked(
		map[string]any{"email": "alice@example.com", "aliases": []any{"ali"}},
		map[string]bool{"email": true, "aliases": false},
	), nil)
	w.expectOwner("email", "alice@example.com", "")
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-register", result.Step.Name)
}

// A concurrent collision bound "u-b" while this flow's cookie recorded the
// row as collected: the state catches up and the collision outcome is raised.
func TestFlowStateMachine_Render_SSOCollisionReconcilesLostCookieRace(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	state.SSOResolvedCheckID = "ch-1"
	w.ssoIdentities.EXPECT().
		LoadParked(gomock.Any(), domain.FlowSSOLoadInput{
			ProjectID: testProjectID, AttemptID: "att-1", UserSchemaURL: defaultSchemaURL, ResolvedCheckID: "ch-1",
		}).
		Return(&domain.FlowSSOParkedIdentity{CheckID: "ch-1", CollisionUserID: "u-b", AttemptUserID: "u-b"}, nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-conflict", result.Step.Name)
	assert.Equal(t, "u-b", result.State.CollectedData.UserID)
	assert.True(t, result.Reseal)
}

// The catch-up runs on the step the cookie now holds, which may not route
// user_already_exists: the step shows the provider as unavailable instead of
// failing every render until the attempt expires.
func TestFlowStateMachine_Render_SSOCollisionReconcileUnroutableRendersError(t *testing.T) {
	t.Parallel()
	action := domain.Switch
	for name, transition := range map[string]*domain.FlowStepTransition{
		"missing":     nil,
		"with action": {Target: "other-flow", Action: &action},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := ssoRenderWorld(t)
			if transition != nil {
				def.Steps[0].Transitions[domain.FlowImplicitOutcomeUserAlreadyExists] = *transition
			}
			state.SSOResolvedCheckID = "ch-1"
			w.ssoIdentities.EXPECT().LoadParked(gomock.Any(), gomock.Any()).
				Return(&domain.FlowSSOParkedIdentity{CheckID: "ch-1", CollisionUserID: "u-b", AttemptUserID: "u-b"}, nil)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, "credentials", result.Step.Name)
			require.NotNil(t, result.Step.Error)
			assert.Equal(t, domain.FlowStepErrorSSOUnavailable, *result.Step.Error)
			assert.Empty(t, result.State.CollectedData.UserID)
			assert.False(t, result.Reseal)
		})
	}
}

func TestFlowStateMachine_Render_SSOCollisionReconcileWithRecordedUserRendersStep(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	state.SSOResolvedCheckID = "ch-1"
	state.CollectedData.UserID = "u-b"
	w.ssoIdentities.EXPECT().LoadParked(gomock.Any(), gomock.Any()).Return(&domain.FlowSSOParkedIdentity{CheckID: "ch-1", CollisionUserID: "u-b", AttemptUserID: "u-b"}, nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "credentials", result.Step.Name)
	assert.Nil(t, result.Step.Error)
	assert.False(t, result.Reseal)
}

// The flow identified u-b before SSO, and the response that routed the
// collision was lost: the cookie names the user but not the row, so the
// outcome is raised again.
func TestFlowStateMachine_Render_SSOCollisionReconcileWithUserIdentifiedBeforeSSORaisesAgain(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	state.CollectedData.UserID = "u-b"
	w.ssoIdentities.EXPECT().LoadParked(gomock.Any(), gomock.Any()).Return(&domain.FlowSSOParkedIdentity{CheckID: "ch-1", CollisionUserID: "u-b", AttemptUserID: "u-b"}, nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-conflict", result.Step.Name)
	assert.Equal(t, "u-b", result.State.CollectedData.UserID)
	assert.Equal(t, "ch-1", result.State.SSOResolvedCheckID)
	assert.True(t, result.Reseal)
}

func TestFlowStateMachine_Render_SSOCollisionReconcileWithOtherUserRestarts(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	state.SSOResolvedCheckID = "ch-1"
	state.CollectedData.UserID = "u-a"
	w.ssoIdentities.EXPECT().LoadParked(gomock.Any(), gomock.Any()).Return(&domain.FlowSSOParkedIdentity{CheckID: "ch-1", CollisionUserID: "u-b", AttemptUserID: "u-b"}, nil)

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

// The attempt carries the user of a signed-in session the flow started on,
// which the flow state does not record. An identity that does not collide
// with that user cannot register a new one on this attempt.
func TestFlowStateMachine_Render_SSOUnlinkedIdentityOnSessionBoundAttemptRestarts(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	parked := unlinkedParked(map[string]any{"email": "alice@example.com"}, nil)
	parked.AttemptUserID = "u-s"
	w.expectParked(parked, nil)
	w.expectOwner("email", "alice@example.com", "")
	w.ssoIdentities.EXPECT().CreateLinked(gomock.Any(), gomock.Any()).Times(0)

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
	assert.Empty(t, state.CollectedData.UserID)
}

// The probe finds the very user the session-bound attempt carries: that is a
// collision bound to that user, not a restart.
func TestFlowStateMachine_Render_SSOCollisionOnSessionBoundAttemptSameOwnerBinds(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOOutcomeSteps(def)
	parked := unlinkedParked(map[string]any{"email": "alice@example.com"}, nil)
	parked.AttemptUserID = "u-s"
	w.expectParked(parked, nil)
	w.expectOwner("email", "alice@example.com", "u-s")
	w.expectBindCollision("u-s", nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, "sso-conflict", result.Step.Name)
	assert.Equal(t, "u-s", result.State.CollectedData.UserID)
}

// The marker names u-a but the attempt now carries u-b (a stale submission
// overwrote the user factor after the collision): the marker cannot be
// trusted, and the flow starts over without recording anyone.
func TestFlowStateMachine_Render_SSOCollisionMarkerWithDifferentAttemptUserRestarts(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	w.ssoIdentities.EXPECT().LoadParked(gomock.Any(), gomock.Any()).
		Return(&domain.FlowSSOParkedIdentity{CheckID: "ch-1", CollisionUserID: "u-a", AttemptUserID: "u-b"}, nil)

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
	assert.Empty(t, state.CollectedData.UserID)
}

// withSSOCollectionStep turns sso-register of [withSSOOutcomeSteps] into the
// step that creates the user from the parked identity.
func withSSOCollectionStep(def *domain.FlowDefinition) *domain.FlowDefinition {
	def = withSSOOutcomeSteps(def)
	withSSO := domain.FlowOnSuccessCreateUserWithSso
	step := &def.Steps[len(def.Steps)-1]
	step.Fields = []domain.Field{"email", "username", "given_name", "family_name"}
	step.OnSuccess = &withSSO
	return def
}

// collectionStepWorld sits on the collection step after the engine resolved
// the parked row ch-1 into it.
func collectionStepWorld(t *testing.T) (*flowTestWorld, *domain.FlowDefinition, *domain.FlowState) {
	t.Helper()
	w, def, state := ssoRenderWorld(t)
	state.CurrentStep = "sso-register"
	state.SSOResolvedCheckID = "ch-1"
	w.ssoIdentities.EXPECT().
		LoadParked(gomock.Any(), domain.FlowSSOLoadInput{
			ProjectID:       testProjectID,
			AttemptID:       "att-1",
			UserSchemaURL:   defaultSchemaURL,
			ResolvedCheckID: "ch-1",
		}).
		Return(nil, nil)
	return w, withSSOCollectionStep(def), state
}

// expectCollected makes LoadCollected hand back collected for the row ch-1.
func (w *flowTestWorld) expectCollected(collected *domain.FlowSSOParkedIdentity, err error) {
	w.ssoIdentities.EXPECT().
		LoadCollected(gomock.Any(), domain.FlowSSOLoadInput{
			ProjectID:       testProjectID,
			AttemptID:       "att-1",
			UserSchemaURL:   defaultSchemaURL,
			ResolvedCheckID: "ch-1",
		}).
		Return(collected, err)
}

// renderedValues maps each prefilled field to its value.
func renderedValues(fields []domain.FlowField) map[string]string {
	values := map[string]string{}
	for _, f := range fields {
		if f.Value != nil {
			values[f.Name] = *f.Value
		}
	}
	return values
}

// An identity the provider left incomplete is collected on a step that
// renders with the provider's claims filled in.
func TestFlowStateMachine_Render_SSOUserNotFoundPrefillsCollectionStep(t *testing.T) {
	t.Parallel()
	w, def, state := ssoRenderWorld(t)
	def = withSSOCollectionStep(def)
	parked := unlinkedParked(map[string]any{"email": "alice@example.com", "given_name": "Alice"}, map[string]bool{"email": true})
	w.expectParked(parked, nil)
	w.expectOwner("email", "alice@example.com", "")
	w.expectCollected(parked, nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	require.Equal(t, "sso-register", result.Step.Name)
	assert.Equal(t, map[string]string{"email": "alice@example.com", "given_name": "Alice"}, renderedValues(result.Step.Fields))
}

// The provider's claims fill the fields first, and what earlier steps
// collected fills the rest. A claim that is not a string prefills nothing.
func TestFlowStateMachine_Render_SSOCollectionStepPrefillsClaimsBeforeCollected(t *testing.T) {
	t.Parallel()
	w, def, state := collectionStepWorld(t)
	state.CollectedData.UserData = map[string]any{"email": "typed@example.com", "username": "typed", "given_name": "Typed"}
	w.expectCollected(unlinkedParked(map[string]any{"email": "alice@example.com", "given_name": 42}, nil), nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Equal(t, map[string]string{
		"email":      "alice@example.com",
		"username":   "typed",
		"given_name": "Typed",
	}, renderedValues(result.Step.Fields))
}

// With no parked row the step renders empty and with no error. Values earlier
// steps collected are not filled in either: the submit cannot succeed.
func TestFlowStateMachine_Render_SSOCollectionStepWithoutParkedRowRendersEmpty(t *testing.T) {
	t.Parallel()
	w, def, state := collectionStepWorld(t)
	state.CollectedData.UserData = map[string]any{"email": "typed@example.com", "username": "typed"}
	w.expectCollected(nil, nil)

	result, err := w.sm.Render(t.Context(), def, state)
	require.NoError(t, err)
	assert.Nil(t, result.Step.Error)
	assert.Empty(t, renderedValues(result.Step.Fields))
}

func TestFlowStateMachine_Render_SSOCollectionStepLoadErrorPropagates(t *testing.T) {
	t.Parallel()
	w, def, state := collectionStepWorld(t)
	w.expectCollected(nil, domain.ErrFlowRestartRequired())

	_, err := w.sm.Render(t.Context(), def, state)
	require.ErrorIs(t, err, domain.ErrFlowRestartRequired())
}

// boundCollectionStepWorld sits on the collection step, whose only submit
// action routes to done, after an earlier request created the user on it but
// did not deliver the handoff: the row is gone and the attempt is bound.
func boundCollectionStepWorld(t *testing.T) (*flowTestWorld, *domain.FlowDefinition, *domain.FlowState) {
	t.Helper()
	w, def, state := ssoRenderWorld(t)
	def = withSSOCollectionStep(def)
	step := &def.Steps[len(def.Steps)-1]
	step.Actions = []domain.FlowStepAction{{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true}}
	step.Transitions = map[string]domain.FlowStepTransition{domain.FlowActionSubmit: {Target: "done"}}
	state.CurrentStep = "sso-register"
	state.SSOResolvedCheckID = "ch-1"
	state.History = []string{"credentials"}
	state.BackStack = []domain.FlowBackEntry{{StepName: "credentials", Purpose: domain.FlowDefinitionPurposeRegister}}
	w.ssoIdentities.EXPECT().
		LoadParked(gomock.Any(), domain.FlowSSOLoadInput{
			ProjectID:       testProjectID,
			AttemptID:       "att-1",
			UserSchemaURL:   defaultSchemaURL,
			ResolvedCheckID: "ch-1",
		}).
		Return(&domain.FlowSSOParkedIdentity{BoundUserID: "user-1"}, nil)
	// The step's inputs resolve before the retry, and the prefill finds the
	// row gone.
	w.expectCollected(nil, nil)
	return w, def, state
}

// The collection step routes no sso_authenticated, so the retry follows the
// transition the create follows, and the step that created the user offers
// no back. sso_authenticated still wins where the step routes it, and keeps
// the back stack, as on any other step.
func TestFlowStateMachine_Render_SSOCollectionStepRetriesHandoff(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		edit          func(step *domain.FlowDefinitionStep)
		wantStep      string
		wantBackStack bool
	}{
		"submit action": {edit: func(*domain.FlowDefinitionStep) {}, wantStep: "done"},
		"renamed submit action": {
			edit: func(step *domain.FlowDefinitionStep) {
				step.Actions[0].Name = "create"
				step.Transitions = map[string]domain.FlowStepTransition{"create": {Target: "done"}}
			},
			wantStep: "done",
		},
		"navigate action beside it": {
			edit: func(step *domain.FlowDefinitionStep) {
				step.Actions = append(step.Actions, domain.FlowStepAction{Name: "sign_in", Kind: domain.FlowActionKindNavigate})
				step.Transitions["sign_in"] = domain.FlowStepTransition{Target: "credentials"}
			},
			wantStep: "done",
		},
		// A later step, not the end of the flow, shows the back stack.
		"submit to a later step": {
			edit: func(step *domain.FlowDefinitionStep) {
				step.Transitions[domain.FlowActionSubmit] = domain.FlowStepTransition{Target: "sso-conflict"}
			},
			wantStep: "sso-conflict",
		},
		"sso_authenticated routed": {
			edit: func(step *domain.FlowDefinitionStep) {
				step.Transitions[domain.FlowImplicitOutcomeSSOAuthenticated] = domain.FlowStepTransition{Target: "sso-conflict"}
			},
			wantStep:      "sso-conflict",
			wantBackStack: true,
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := boundCollectionStepWorld(t)
			tc.edit(&def.Steps[len(def.Steps)-1])
			if tc.wantStep == "done" {
				w.authAttemptService.EXPECT().
					Handoff(gomock.Any(), domain.FlowHandoffInput{ProjectID: testProjectID, AttemptID: "att-1"}).
					Return(domain.FlowHandoffOutput{Token: "handoff-1", ExpiresAt: time.Unix(1700000060, 0).UTC()}, nil)
			}

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			require.Equal(t, tc.wantStep, result.Step.Name)
			assert.Equal(t, "user-1", result.State.CollectedData.UserID)
			assert.Equal(t, tc.wantBackStack, len(result.State.BackStack) > 0)
		})
	}
}

// A transition that would drop the bound user, or a step whose submit
// actions leave the retry no single route, keeps the step and shows the
// provider as unavailable, as on any step that cannot route the retry.
func TestFlowStateMachine_Render_SSOCollectionStepUnroutableRetry(t *testing.T) {
	t.Parallel()
	register := domain.FlowDefinitionPurposeRegister
	action := domain.Switch
	for name, edit := range map[string]func(step *domain.FlowDefinitionStep){
		"with purpose": func(step *domain.FlowDefinitionStep) {
			step.Transitions[domain.FlowActionSubmit] = domain.FlowStepTransition{Target: "done", Purpose: &register}
		},
		"with action": func(step *domain.FlowDefinitionStep) {
			step.Transitions[domain.FlowActionSubmit] = domain.FlowStepTransition{Target: "other-flow", Action: &action}
		},
		"two submit actions": func(step *domain.FlowDefinitionStep) {
			step.Actions = append(step.Actions, domain.FlowStepAction{Name: "get_help", Kind: domain.FlowActionKindSubmit})
			step.Transitions["get_help"] = domain.FlowStepTransition{Target: "done"}
		},
		"no submit action": func(step *domain.FlowDefinitionStep) {
			step.Actions = nil
			step.Transitions = nil
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w, def, state := boundCollectionStepWorld(t)
			edit(&def.Steps[len(def.Steps)-1])
			w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)

			result, err := w.sm.Render(t.Context(), def, state)
			require.NoError(t, err)
			assert.Equal(t, "sso-register", result.Step.Name)
			require.NotNil(t, result.Step.Error)
			assert.Equal(t, domain.FlowStepErrorSSOUnavailable, *result.Step.Error)
			assert.Empty(t, result.State.CollectedData.UserID)
			assert.False(t, result.Reseal)
		})
	}
}
