package flowengine_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"github.com/zitadel/nextgen/internal/flowengine"
)

const testProjectID = "proj-1"

func mustUnmarshal[T any](t *testing.T, content string) *T {
	value := new(T)
	err := json.Unmarshal([]byte(content), value)
	require.NoError(t, err)
	return value
}

// defaultSchema covers email/username/given_name/family_name with the
// same shape as the embedded built-in. Inlining it keeps test setup
// self-contained.
const defaultSchemaURL = "https://example.test/user/v1/default.user.schema.json"

const defaultSchemaContent string = `{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"type": "object",
		"x-auth-methods": { "password": { "enabled": true }, "passkey": { "enabled": true } },
		"x-identifier": "email",
		"required": ["email", "username", "given_name", "family_name"],
		"properties": {
			"email":       { "type": "string", "format": "email", "maxLength": 320, "x-unique": "team" },
			"username":    { "type": "string", "minLength": 3, "maxLength": 64, "x-unique": "team" },
			"given_name":  { "type": "string", "minLength": 1, "maxLength": 200 },
			"family_name": { "type": "string", "minLength": 1, "maxLength": 200 }
		}
	}`

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
// on, the value it carries and the flow's bound schema (every caller starts
// the flow on defaultSchemaURL), so a test pinning rotation cannot pass on a
// call that went to the wrong attempt.
func identifiedBy(attemptID, attribute, value string) gomock.Matcher {
	return gomock.Cond(func(in domain.FlowSubmitIdentifierInput) bool {
		return in.AttemptID == attemptID && in.AttributeName == attribute && in.Value == value &&
			in.UserSchemaURL == defaultSchemaURL
	})
}

func findAction(actions []flowengine.FlowAction, name string) (flowengine.FlowAction, bool) {
	for _, a := range actions {
		if a.Name == name {
			return a, true
		}
	}
	return flowengine.FlowAction{}, false
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
	passwords          *fakePasswordPolicy
	sm                 *flowengine.FlowStateMachineRuntime
}

// fakePasswordPolicy answers the password length bounds; the zero value is a
// project without a policy.
type fakePasswordPolicy struct {
	minLength, maxLength int
	err                  error
	calls                int
}

func (f *fakePasswordPolicy) PasswordLengthBounds(context.Context, string) (int, int, error) {
	f.calls++
	if f.err != nil {
		return 0, 0, f.err
	}
	if f.maxLength == 0 {
		return f.minLength, domain.MaxPasswordLength, nil
	}
	return f.minLength, f.maxLength, nil
}

func newFlowTestWorld(t *testing.T) *flowTestWorld {
	t.Helper()
	mock := gomock.NewController(t)

	hasher := cryptomock.NewMockHasher(mock)
	hasher.EXPECT().
		Hash(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, s string) (string, error) { return "hashed:" + s, nil }).
		AnyTimes()

	schemaResolver := domainmock.NewMockSchemaResolver(mock)
	schemaStore := domainmock.NewMockJSONSchemaStore(mock)
	authAttemptService := domainmock.NewMockFlowAuthAttemptService(mock)
	createUser := domainmock.NewMockFlowOnSuccessHandler(mock)
	ssoProviders := domainmock.NewMockFlowSSOProviderResolver(mock)
	ssoIdentities := domainmock.NewMockFlowSSOIdentityService(mock)
	ssoRedirects := domainmock.NewMockFlowSSORedirectIssuer(mock)
	passwords := &fakePasswordPolicy{}

	resolver := domain.NewSchemaFieldResolver()

	now := func() time.Time { return time.Unix(1700000000, 0).UTC() }

	sm := flowengine.NewFlowStateMachine(flowengine.FlowStateMachineDeps{
		Schemas:       schemaResolver,
		SchemaStore:   schemaStore,
		Fields:        resolver,
		CreateUser:    createUser,
		AuthAttempts:  authAttemptService,
		SSOProviders:  ssoProviders,
		SSOIdentities: ssoIdentities,
		SSORedirects:  ssoRedirects,
		Passwords:     passwords,
		Now:           now,
	})

	return &flowTestWorld{
		mock:               mock,
		hasher:             hasher,
		schemaResolver:     schemaResolver,
		authAttemptService: authAttemptService,
		createUser:         createUser,
		ssoProviders:       ssoProviders,
		ssoIdentities:      ssoIdentities,
		ssoRedirects:       ssoRedirects,
		passwords:          passwords,
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
					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionSubmit:            {Target: "done"},
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
					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionSubmit: {Target: "done"},
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
			// The attempt records the flow, or the exchange's events lose it.
			return in.ProjectID == testProjectID && in.FlowID == "flow_01TEST" && in.SessionID != nil && *in.SessionID == "sess-1"
		})).
		Return("att_01TEST", nil).
		Times(1)

	result, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		ID:            "flow_01TEST",
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "credentials", result.Step.Name)
	require.Equal(t, "credentials", result.State.CurrentStep)
	assert.Equal(t, testProjectID, result.State.ProjectID)
	assert.Equal(t, defaultSchemaURL, result.State.UserSchemaURL)
	assert.True(t, containsFieldName(result.Step.Fields, "email"))
	act, ok := findAction(result.Step.Actions, flowengine.FlowActionSubmit)
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
				in.State.CollectedData.AuthMethods[domain.AuthMethodPassword] == password
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
			// Register marks the lookup as a sign-up's, which records no
			// failed check when the email is free.
			return in.Value == email && in.Register
		})).
		Return("", domain.ErrAuthAttemptProofRejected(nil)).
		Times(1)
	// Register mode dispatches identifier (the email is x-unique, so it
	// always routes through auth-attempt to emit user_already_exists when
	// the name is taken). It must not dispatch password — create_user
	// establishes the credential per its manifest.
	w.authAttemptService.EXPECT().SubmitPassword(gomock.Any(), gomock.Any()).Times(0)

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
				assert.Equal(t, email, in.Value) &&
				assert.False(t, in.Register, "a sign-in's lookup is not a sign-up's")
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
			"email":                   email,
			"x-auth-methods#password": "wrong-password",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "credentials", result.Step.Name)
	require.NotNil(t, result.Step.Error)
	assert.Equal(t, flowengine.FlowStepErrorInvalidCredentials, *result.Step.Error)
	// The key travels with the rejection that produced it, for the log.
	require.NotNil(t, result.Step.Failure)
	assert.Equal(t, flowengine.FlowStepErrorInvalidCredentials, result.Step.Failure.Key)
	assert.ErrorIs(t, result.Step.Failure.Cause, domain.ErrAuthAttemptProofRejected(nil))
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
			{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
		},
		Transitions: map[string]domain.FlowStepTransition{
			flowengine.FlowActionSubmit: {Target: "done"},
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

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	collided, err := w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{
			"email":                   "alice@example.com",
			"x-auth-methods#password": "attacker-chosen",
		},
	})
	require.NoError(t, err)
	require.Equal(t, "password", collided.State.CurrentStep)
	require.Equal(t, domain.FlowDefinitionPurposeLogin, collided.State.CurrentPurpose)

	result, err := w.sm.Process(t.Context(), def, collided.State, flowengine.FlowSubmitInput{
		Action: flowengine.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "wrong-password"},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "password", result.Step.Name)
	require.NotNil(t, result.Step.Error)
	assert.Equal(t, flowengine.FlowStepErrorInvalidCredentials, *result.Step.Error)
	assert.Empty(t, result.HandoffToken)
}

func TestFlowStateMachine_Process_InvalidActionRejected(t *testing.T) {
	t.Parallel()
	w := newFlowTestWorld(t)

	w.schemaResolver.EXPECT().
		Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
		Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
		AnyTimes()
	w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
	// No identifier or on_success expectation: the action is refused before
	// either runs, so no user is created for a submission that fails.

	def := signupDefinition()

	start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	_, err = w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
		Action: "not_declared",
		Fields: map[string]any{
			"email":                   "alice@example.com",
			"x-auth-methods#password": "correct-horse-battery-staple",
		},
	})
	require.ErrorIs(t, err, domain.ErrFlowInvalidAction())
}

// An outcome name, or no name at all, is not an action the step declares,
// so it is refused before the identifier is looked up. Before #1457 it ran
// the identifier challenge and then took the route the engine keeps for
// that outcome, which for sso_authenticated reached the terminal step
// without any factor proven.
func TestFlowStateMachine_Process_UndeclaredActionRefusedBeforeIdentifierLookup(t *testing.T) {
	t.Parallel()
	ssoLogin := func() *domain.FlowDefinition {
		def := loginRegisterFlipDefinition()
		def.Steps[0].SSOProviders = []string{"google"}
		def.Steps[0].Transitions[domain.FlowImplicitOutcomeSSOAuthenticated] = domain.FlowStepTransition{Target: "done"}
		return def
	}
	tests := []struct {
		name   string
		def    func() *domain.FlowDefinition
		action string
	}{
		{name: "sso_authenticated", def: ssoLogin, action: domain.FlowImplicitOutcomeSSOAuthenticated},
		{name: "user_not_found", def: loginRegisterFlipDefinition, action: domain.FlowImplicitOutcomeUserNotFound},
		{name: "empty action", def: loginRegisterFlipDefinition, action: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			w := newFlowTestWorld(t)
			def := tt.def()
			w.schemaResolver.EXPECT().
				Resolve(gomock.Any(), gomock.Any(), gomock.Any(), defaultSchemaURL, gomock.Any()).
				Return(mustUnmarshal[jsonschema.Schema](t, defaultSchemaContent), nil).
				AnyTimes()
			w.ssoProviders.EXPECT().
				Resolve(gomock.Any(), gomock.Any(), gomock.Any()).
				Return([]domain.FlowSSOProvider{{ID: "google", Name: "Google"}}, nil).
				AnyTimes()
			w.authAttemptService.EXPECT().Start(gomock.Any(), gomock.Any()).Return("attempt-1", nil)
			// No SubmitIdentifier or Handoff expectation: the controller
			// fails the test on either call.

			start, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
				Definition:    def,
				Purpose:       domain.FlowDefinitionPurposeLogin,
				Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
				UserSchemaURL: defaultSchemaURL,
			})
			require.NoError(t, err)

			_, err = w.sm.Process(t.Context(), def, start.State, flowengine.FlowSubmitInput{
				Action: tt.action,
				Fields: map[string]any{"email": "alice@example.com"},
			})
			require.ErrorIs(t, err, domain.ErrFlowInvalidAction())
		})
	}
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

			result, err := w.sm.Start(t.Context(), flowengine.FlowStartInput{
				Definition:    def,
				Purpose:       tc.purpose,
				Session:       flowengine.FlowSessionRef{ID: "sess-1", Version: 1},
				UserSchemaURL: defaultSchemaURL,
			})
			require.NoError(t, err)
			assert.Equal(t, tc.purpose, result.State.Purpose)
			assert.Equal(t, tc.purpose, result.State.CurrentPurpose)
		})
	}
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
					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionSubmit:                 {Target: "set-password"},
					domain.FlowImplicitOutcomeUserAlreadyExists: {Target: "done"},
				},
			},
			{
				Name:   "set-password",
				Fields: []domain.Field{"x-auth-methods#password"},
				Actions: []domain.FlowStepAction{
					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionSubmit: {Target: "create"},
				},
			},
			{
				Name:      "create",
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

// findBackAction returns the engine-injected back action on a rendered
// step, or nil if it isn't present. Tests key on kind, not name — the
// contract is kind-driven.
func findBackAction(step *flowengine.FlowStep) *flowengine.FlowAction {
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
					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionSubmit:            {Target: "password"},
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

// TestFlowStepErrorContract sweeps every value the engine can emit as
// `step.Error` and pins the client contract: a localizable `error.*`
// text key. The scenario tests above prove each value is emitted where
// expected; this gate is what fails when a new emission value (a
// step-error const, an implicit outcome without its own key, a
// validation rule) breaks the dialect /login localizes.
func TestFlowStepErrorContract(t *testing.T) {
	t.Parallel()

	stepErrorConsts := []string{
		flowengine.FlowStepErrorInvalidCredentials,
		flowengine.FlowStepErrorPasskeyInvalid,
		flowengine.FlowStepErrorPasskeyRegistrationInvalid,
		flowengine.FlowStepErrorSSOCreationDisabled,
		flowengine.FlowStepErrorSSOUnavailable,
		flowengine.FlowStepErrorSSOCancelled,
		flowengine.FlowStepErrorSSOFailed,
		flowengine.FlowStepErrorSSOVerifiedUniqueValueChanged,
		flowengine.FlowStepErrorSSOUserInvalid,
		flowengine.FlowStepErrorSSOUserCannotBeCreated,
		flowengine.FlowStepErrorUserAlreadyExists,
		flowengine.FlowStepErrorUserNotFound,
		flowengine.FlowStepErrorSSOUserNotFound,
		flowengine.FlowStepErrorOutcomeUnhandled,
		flowengine.FlowStepErrorSignInFirst,
	}
	for _, key := range stepErrorConsts {
		assert.True(t, strings.HasPrefix(key, "error."), "step-error const %q must honor the contract", key)
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
			assert.NotEqual(t, flowengine.FlowStepErrorOutcomeUnhandled, flowengine.UnwiredOutcomeError(outcome),
				"implicit outcome %q of challenge %q needs its own step error key", outcome, challenge)
		}
	}
	assert.Equal(t, flowengine.FlowStepErrorOutcomeUnhandled, flowengine.UnwiredOutcomeError("some_new_outcome"))

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
			assert.True(t, strings.HasPrefix(key, "error."),
				"validation key %q (field %q, rule %q) must honor the contract", key, field, rule)
		}
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
					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
					{Name: flowengine.FlowActionPasskey, Kind: domain.FlowActionKindPasskey},
					{Name: "register", Kind: domain.FlowActionKindNavigate},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionSubmit:            {Target: "password"},
					flowengine.FlowActionPasskey:           {Target: "done"},
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
					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
					{Name: flowengine.FlowActionPasskey, Kind: domain.FlowActionKindPasskey},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionSubmit:  {Target: "done"},
					flowengine.FlowActionPasskey: {Target: "done"},
				},
			},
			{
				Name:   "register",
				Fields: []domain.Field{"email"},
				Actions: []domain.FlowStepAction{
					{Name: flowengine.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
					{Name: "sign_in", Kind: domain.FlowActionKindNavigate},
				},
				Transitions: map[string]domain.FlowStepTransition{
					flowengine.FlowActionSubmit: {Target: "register-password"},
					"sign_in":                   {Target: "identifier", Purpose: &login},
					domain.FlowImplicitOutcomeUserAlreadyExists: {Target: "password"},
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
