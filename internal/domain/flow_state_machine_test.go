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

	// passkey
	issueCalls    []domain.FlowIssuePasskeyChallengeInput
	issueOut      domain.FlowPasskeyChallengeOutput
	issueErr      error
	passkeyCalls  []domain.FlowSubmitPasskeyInput
	passkeyUserID string
	passkeyErr    error
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

func (f *fakeAuthAttempts) IssuePasskeyChallenge(_ context.Context, in domain.FlowIssuePasskeyChallengeInput) (domain.FlowPasskeyChallengeOutput, error) {
	f.issueCalls = append(f.issueCalls, in)
	return f.issueOut, f.issueErr
}

func (f *fakeAuthAttempts) SubmitPasskey(_ context.Context, in domain.FlowSubmitPasskeyInput) (string, error) {
	f.passkeyCalls = append(f.passkeyCalls, in)
	return f.passkeyUserID, f.passkeyErr
}

// fakePasskeyRegistration is a test double for [domain.FlowPasskeyRegistrationService].
type fakePasskeyRegistration struct {
	issueCalls  []domain.FlowIssuePasskeyRegistrationChallengeInput
	issueOut    domain.FlowPasskeyRegistrationChallengeOutput
	issueErr    error
	submitCalls []domain.FlowSubmitPasskeyRegistrationInput
	submitErr   error
}

func (f *fakePasskeyRegistration) IssuePasskeyRegistrationChallenge(_ context.Context, in domain.FlowIssuePasskeyRegistrationChallengeInput) (domain.FlowPasskeyRegistrationChallengeOutput, error) {
	f.issueCalls = append(f.issueCalls, in)
	return f.issueOut, f.issueErr
}

func (f *fakePasskeyRegistration) SubmitPasskeyRegistration(_ context.Context, in domain.FlowSubmitPasskeyRegistrationInput) error {
	f.submitCalls = append(f.submitCalls, in)
	return f.submitErr
}

// flowTestWorld is the wiring a flow test exercises: resolver +
// registry + handlers + state machine, sharing the fakes the test
// inspects after a run.
type flowTestWorld struct {
	users        *fakeUserRepo
	pws          *fakeUserPasswordRepo
	ids          *idgenmock.MockGenerator
	hasher       fakeHasher
	attempts     *fakeAuthAttempts
	passkeyReg   *fakePasskeyRegistration
	sm           *domain.FlowStateMachineRuntime
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
	passkeyReg := &fakePasskeyRegistration{}

	createUser := domain.NewFlowCreateUserHandler(ids, users, pws, hasher)
	resolver := newDefaultResolver(t)
	now := func() time.Time { return time.Unix(1700000000, 0).UTC() }
	sm := domain.NewFlowStateMachine(resolver, createUser, attempts, passkeyReg, now)

	return &flowTestWorld{users: users, pws: pws, ids: ids, hasher: hasher, attempts: attempts, passkeyReg: passkeyReg, sm: sm}
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

	assert.Empty(t, w.attempts.identifyCalls, "create_user must not dispatch identifier challenge")
	assert.Empty(t, w.attempts.passwordCalls, "create_user must not dispatch password challenge")
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
				Actions: map[string]domain.FlowStepAction{
					domain.FlowActionPasskey: {Primary: true},
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
	w := newFlowTestWorld(t)
	w.attempts.issueOut = domain.FlowPasskeyChallengeOutput{ChallengeID: "ch-1", Options: []byte(`{"publicKey":{}}`)}
	w.attempts.passkeyUserID = "user_alice"
	def := passkeyLoginDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Issue leg: selecting the passkey action mints a challenge and halts on the
	// same step, surfacing the ceremony options.
	issued, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.Step.Challenge)
	assert.Equal(t, "ch-1", issued.Step.Challenge.ChallengeID)
	assert.Equal(t, domain.FlowChallengeMethodPasskey, issued.Step.Challenge.Method)
	assert.Equal(t, []byte(`{"publicKey":{}}`), issued.Step.Challenge.Options)
	require.NotNil(t, issued.State.PendingChallenge)
	assert.Equal(t, "authenticate", issued.State.CurrentStep)
	require.Len(t, w.attempts.issueCalls, 1)
	assert.Equal(t, "example.com", w.attempts.issueCalls[0].RPID)

	// Verify leg: the signed assertion clears the challenge and advances.
	verified, err := w.sm.Process(t.Context(), nil, def, issued.State, domain.FlowSubmitInput{
		Action:            domain.FlowActionPasskey,
		ChallengeResponse: &domain.FlowChallengeResponse{ChallengeID: "ch-1", Method: "passkey", Proof: []byte(`{"id":"x"}`)},
	})
	require.NoError(t, err)
	assert.Nil(t, verified.State.PendingChallenge)
	require.Len(t, w.attempts.passkeyCalls, 1)
	assert.Equal(t, "ch-1", w.attempts.passkeyCalls[0].ChallengeID)
	assert.Equal(t, []byte(`{"id":"x"}`), w.attempts.passkeyCalls[0].Assertion)
	require.NotNil(t, verified.Step.Complete)
	assert.Equal(t, "handoff_01TEST", verified.HandoffToken)
	assert.Equal(t, "user_alice", verified.State.CollectedData[domain.FlowCollectedUserIDKey])
}

func TestFlowStateMachine_Process_PasskeyProofRejectedKeepsStep(t *testing.T) {
	w := newFlowTestWorld(t)
	w.attempts.issueOut = domain.FlowPasskeyChallengeOutput{ChallengeID: "ch-1", Options: []byte(`{"publicKey":{}}`)}
	w.attempts.passkeyErr = domain.ErrAuthAttemptProofRejected(nil)
	def := passkeyLoginDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	issued, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	rejected, err := w.sm.Process(t.Context(), nil, def, issued.State, domain.FlowSubmitInput{
		Action:            domain.FlowActionPasskey,
		ChallengeResponse: &domain.FlowChallengeResponse{ChallengeID: "ch-1", Proof: []byte(`{}`)},
	})
	require.NoError(t, err)
	require.NotNil(t, rejected.Step.Error)
	assert.Equal(t, "auth_attempt.passkey_invalid", *rejected.Step.Error)
	assert.Nil(t, rejected.State.PendingChallenge)
	assert.Equal(t, "authenticate", rejected.State.CurrentStep)
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
				Actions: map[string]domain.FlowStepAction{
					domain.FlowActionPasskeyRegister: {Primary: true},
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
	w := newFlowTestWorld(t)
	w.passkeyReg.issueOut = domain.FlowPasskeyRegistrationChallengeOutput{
		ChallengeID: "reg-1",
		Options:     []byte(`{"rp":{"id":"example.com"}}`),
	}
	def := passkeyRegisterDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	// Pre-seed a resolved user so passkey_register can proceed.
	start.State.CollectedData[domain.FlowCollectedUserIDKey] = "user_alice"

	// Issue leg: passkey_register action mints a creation challenge.
	issued, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskeyRegister,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.Step.Challenge)
	assert.Equal(t, "reg-1", issued.Step.Challenge.ChallengeID)
	assert.Equal(t, domain.FlowChallengeMethodPasskeyRegister, issued.Step.Challenge.Method)
	require.NotNil(t, issued.State.PendingChallenge)
	require.Len(t, w.passkeyReg.issueCalls, 1)
	assert.Equal(t, "user_alice", w.passkeyReg.issueCalls[0].UserID)

	// Verify leg: attestation clears the challenge and advances to done.
	verified, err := w.sm.Process(t.Context(), nil, def, issued.State, domain.FlowSubmitInput{
		Action: domain.FlowActionPasskeyRegister,
		ChallengeResponse: &domain.FlowChallengeResponse{
			ChallengeID: "reg-1",
			Method:      domain.FlowChallengeMethodPasskeyRegister,
			Proof:       []byte(`{"attestation":"fake"}`),
		},
	})
	require.NoError(t, err)
	assert.Nil(t, verified.State.PendingChallenge)
	require.Len(t, w.passkeyReg.submitCalls, 1)
	assert.Equal(t, "reg-1", w.passkeyReg.submitCalls[0].ChallengeID)
	assert.Equal(t, []byte(`{"attestation":"fake"}`), w.passkeyReg.submitCalls[0].Attestation)
	require.NotNil(t, verified.Step.Complete)
}

func TestFlowStateMachine_Process_PasskeyRegisterRejectedKeepsStep(t *testing.T) {
	w := newFlowTestWorld(t)
	w.passkeyReg.issueOut = domain.FlowPasskeyRegistrationChallengeOutput{ChallengeID: "reg-1", Options: []byte(`{}`)}
	w.passkeyReg.submitErr = domain.ErrAuthAttemptProofRejected(nil)
	def := passkeyRegisterDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	start.State.CollectedData[domain.FlowCollectedUserIDKey] = "user_alice"

	issued, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskeyRegister,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.State.PendingChallenge)

	rejected, err := w.sm.Process(t.Context(), nil, def, issued.State, domain.FlowSubmitInput{
		Action: domain.FlowActionPasskeyRegister,
		ChallengeResponse: &domain.FlowChallengeResponse{
			ChallengeID: "reg-1",
			Method:      domain.FlowChallengeMethodPasskeyRegister,
			Proof:       []byte(`{}`),
		},
	})
	require.NoError(t, err)
	require.NotNil(t, rejected.Step.Error)
	assert.Equal(t, "auth_attempt.passkey_registration_invalid", *rejected.Step.Error)
	assert.Nil(t, rejected.State.PendingChallenge)
	assert.Equal(t, "register", rejected.State.CurrentStep)
}

func TestFlowStateMachine_Process_PasskeyRegisterRequiresIdentifiedUser(t *testing.T) {
	w := newFlowTestWorld(t)
	def := passkeyRegisterDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	// Do NOT seed a user ID — registration must fail.

	_, err = w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskeyRegister,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, domain.ErrIntegrity)
}
