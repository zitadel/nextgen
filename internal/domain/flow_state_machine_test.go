package domain_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen/idgenmock"
	"github.com/zitadel/nextgen/internal/storage/database"
	"go.uber.org/mock/gomock"
)

// fakeHasher is a prefix-based password hasher: Hash returns
// "hashed:"+plain. Trivial to reason about in tests.
type fakeHasher struct{}

func (fakeHasher) Hash(plain string) (string, error) { return "hashed:" + plain, nil }

// fakeUserRepo records the users create_user persists.
type fakeUserRepo struct {
	created []*domain.CreateUser
}

func (f *fakeUserRepo) Create(_ context.Context, _ database.QueryExecutor, user *domain.CreateUser) error {
	f.created = append(f.created, user)
	return nil
}

// fakeUserPasswordRepo records the password rows create_user persists.
type fakeUserPasswordRepo struct {
	created []*domain.CreateUserPassword
}

func (f *fakeUserPasswordRepo) Create(_ context.Context, _ database.QueryExecutor, pw *domain.CreateUserPassword) error {
	f.created = append(f.created, pw)
	return nil
}

// fakeAuthAttempts captures the [domain.FlowAuthAttemptService] calls
// the state machine drives so tests can assert lifecycle wiring,
// challenge dispatch, and ordering.
type fakeAuthAttempts struct {
	startCalls    []domain.FlowCreateAttemptInput
	identifyCalls []domain.FlowSubmitIdentifierInput
	passwordCalls []domain.FlowSubmitPasswordInput
	handoffCalls  []domain.FlowHandoffInput

	nextAttemptID    string
	identifierResult map[string]string // value → resolved user id
	identifierErrs   map[string]error
	passwordErrs     map[string]error
	handoffOutput    domain.FlowHandoffOutput
	handoffErr       error
}

func (f *fakeAuthAttempts) Start(_ context.Context, in domain.FlowCreateAttemptInput) (string, error) {
	f.startCalls = append(f.startCalls, in)
	return f.nextAttemptID, nil
}

func (f *fakeAuthAttempts) SubmitIdentifier(_ context.Context, in domain.FlowSubmitIdentifierInput) (string, error) {
	f.identifyCalls = append(f.identifyCalls, in)
	if err, ok := f.identifierErrs[in.Value]; ok {
		return "", err
	}
	if uid, ok := f.identifierResult[in.Value]; ok {
		return uid, nil
	}
	return "", domain.ErrAuthAttemptProofRejected(nil)
}

func (f *fakeAuthAttempts) SubmitPassword(_ context.Context, in domain.FlowSubmitPasswordInput) error {
	f.passwordCalls = append(f.passwordCalls, in)
	if err, ok := f.passwordErrs[in.Plain]; ok {
		return err
	}
	return nil
}

func (f *fakeAuthAttempts) Handoff(_ context.Context, in domain.FlowHandoffInput) (domain.FlowHandoffOutput, error) {
	f.handoffCalls = append(f.handoffCalls, in)
	return f.handoffOutput, f.handoffErr
}

// flowTestWorld is the wiring a flow test exercises: resolver +
// registry + handlers + state machine, sharing the fakes the test
// inspects after a run.
type flowTestWorld struct {
	users    *fakeUserRepo
	pws      *fakeUserPasswordRepo
	ids      *idgenmock.MockGenerator
	hasher   fakeHasher
	attempts *fakeAuthAttempts
	sm       *domain.FlowStateMachineRuntime
}

func newFlowTestWorld(t *testing.T) *flowTestWorld {
	t.Helper()
	users := &fakeUserRepo{}
	pws := &fakeUserPasswordRepo{}
	ids := idgenmock.NewMockGenerator(gomock.NewController(t))
	ids.EXPECT().
		New(gomock.Any()).
		DoAndReturn(func(prefix string) (string, error) { return prefix + "_01TEST", nil }).
		AnyTimes()
	hasher := fakeHasher{}
	attempts := &fakeAuthAttempts{
		nextAttemptID: "att_01TEST",
		handoffOutput: domain.FlowHandoffOutput{
			Token:     "handoff_01TEST",
			ExpiresAt: time.Unix(1700000060, 0).UTC(),
		},
	}

	createUser := domain.NewFlowCreateUserHandler(ids, users, pws, hasher)
	resolver := newDefaultResolver(t)
	now := func() time.Time { return time.Unix(1700000000, 0).UTC() }
	sm := domain.NewFlowStateMachine(resolver, createUser, attempts, now)

	return &flowTestWorld{users: users, pws: pws, ids: ids, hasher: hasher, attempts: attempts, sm: sm}
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
				Fields: []string{"email", "password"},
				Actions: map[string]domain.FlowStepAction{
					domain.FlowActionSubmit: {Primary: true},
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
				Fields:    []string{"email", "password"},
				OnSuccess: &createUser,
				Actions: map[string]domain.FlowStepAction{
					domain.FlowActionSubmit: {Primary: true},
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
	w := newFlowTestWorld(t)
	def := signupDefinition()

	result, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
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
	assert.Contains(t, result.Step.Fields, "email")
	act, ok := result.Step.Actions[domain.FlowActionSubmit]
	assert.True(t, ok)
	assert.True(t, act.Primary)

	require.Len(t, w.attempts.startCalls, 1)
	assert.Equal(t, testProjectID, w.attempts.startCalls[0].ProjectID)
	assert.Equal(t, "att_01TEST", result.State.AuthAttemptID)
}

func TestFlowStateMachine_Process_RegistrationHappyPath(t *testing.T) {
	w := newFlowTestWorld(t)
	def := signupDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":    "alice@example.com",
			"password": "correct-horse-battery-staple",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "done", result.Step.Name)
	if assert.NotNil(t, result.Step.Complete) {
		assert.Equal(t, domain.FlowStepCompleteShow, *result.Step.Complete)
	}

	require.Len(t, w.users.created, 1)
	wantUserID := "user_01TEST"
	assert.Equal(t, wantUserID, w.users.created[0].ID)

	require.Len(t, w.pws.created, 1)
	assert.Equal(t, "hashed:correct-horse-battery-staple", w.pws.created[0].EncodedHash)

	assert.Equal(t, wantUserID, result.State.CollectedData[domain.FlowCollectedUserIDKey])

	// Register mode dispatches identifier (the email is x-unique, so it
	// always routes through auth-attempt to emit user_already_exists when
	// the name is taken). It must not dispatch password — create_user
	// establishes the credential per its manifest.
	require.Len(t, w.attempts.identifyCalls, 1)
	assert.Equal(t, "alice@example.com", w.attempts.identifyCalls[0].Value)
	assert.Empty(t, w.attempts.passwordCalls, "register mode skips password dispatch")
}

func TestFlowStateMachine_Process_LoginHappyPath(t *testing.T) {
	w := newFlowTestWorld(t)
	w.attempts.identifierResult = map[string]string{
		"alice@example.com": "user_alice",
	}
	def := loginDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":    "alice@example.com",
			"password": "correct-horse-battery-staple",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "done", result.Step.Name)

	require.Len(t, w.attempts.identifyCalls, 1)
	assert.Equal(t, "alice@example.com", w.attempts.identifyCalls[0].Value)
	assert.Equal(t, "email", w.attempts.identifyCalls[0].AttributeName)
	assert.Equal(t, "att_01TEST", w.attempts.identifyCalls[0].AttemptID)

	require.Len(t, w.attempts.passwordCalls, 1)
	assert.Equal(t, "att_01TEST", w.attempts.passwordCalls[0].AttemptID)

	assert.Equal(t, "user_alice", result.State.CollectedData[domain.FlowCollectedUserIDKey])

	require.Len(t, w.attempts.handoffCalls, 1)
	assert.Equal(t, "att_01TEST", w.attempts.handoffCalls[0].AttemptID)
	assert.Equal(t, "handoff_01TEST", result.HandoffToken)
	assert.Equal(t, time.Unix(1700000060, 0).UTC(), result.HandoffTokenExpiresAt)
}

func TestFlowStateMachine_Process_LoginUserNotFound(t *testing.T) {
	w := newFlowTestWorld(t)
	def := loginDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":    "ghost@example.com",
			"password": "irrelevant",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "not_found", result.Step.Name)

	assert.Empty(t, w.attempts.passwordCalls, "password must not be submitted when identifier is unknown")
	assert.Empty(t, w.attempts.handoffCalls, "handoff must not run for an informational terminal reached without an identity")
	assert.Empty(t, result.HandoffToken, "informational terminal must not surface a handoff token")
}

func TestFlowStateMachine_Process_LoginInvalidPassword(t *testing.T) {
	w := newFlowTestWorld(t)
	w.attempts.identifierResult = map[string]string{
		"alice@example.com": "user_alice",
	}
	w.attempts.passwordErrs = map[string]error{
		"wrong-password": domain.ErrAuthAttemptProofRejected(nil),
	}
	def := loginDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":    "alice@example.com",
			"password": "wrong-password",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "credentials", result.Step.Name)
	require.NotNil(t, result.Step.Error)
	assert.Contains(t, *result.Step.Error, "password")
}

func TestFlowStateMachine_Process_FieldValidationErrorKeepsStep(t *testing.T) {
	w := newFlowTestWorld(t)
	def := signupDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":    "not-an-email",
			"password": "correct-horse-battery-staple",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, result.Step)
	require.Equal(t, "credentials", result.Step.Name)
	if assert.NotNil(t, result.Step.Error) {
		assert.Contains(t, *result.Step.Error, "email")
	}
	assert.Empty(t, w.users.created)
}

func TestFlowStateMachine_Process_IntegrityOnMissingTargetStep(t *testing.T) {
	w := newFlowTestWorld(t)
	def := signupDefinition()
	// Mutate the submit transition to point at a non-existent step.
	def.Steps[0].Transitions[domain.FlowActionSubmit] = domain.FlowStepTransition{Target: "nope"}

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	_, err = w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":    "alice@example.com",
			"password": "correct-horse-battery-staple",
		},
	})
	require.ErrorIs(t, err, domain.ErrIntegrity)
}

func TestFlowStateMachine_Process_InvalidActionRejected(t *testing.T) {
	w := newFlowTestWorld(t)
	def := signupDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	_, err = w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: "not_declared",
		Fields: map[string]any{
			"email":    "alice@example.com",
			"password": "correct-horse-battery-staple",
		},
	})
	require.ErrorIs(t, err, domain.ErrInvalidAction)
}

func TestFlowStateMachine_Process_SSOSubmissionUnsupported(t *testing.T) {
	w := newFlowTestWorld(t)
	def := signupDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	_, err = w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action:      domain.FlowActionSubmit,
		SSOProvider: &domain.FlowSSOProviderRef{ID: "google"},
	})
	require.ErrorIs(t, err, domain.ErrUnsupported)
}
