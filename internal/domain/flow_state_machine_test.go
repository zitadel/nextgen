package domain_test

import (
	"context"
	"encoding/json"
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

func findAttribute(attrs []*domain.CreateAttribute, key string) *domain.CreateAttribute {
	for _, a := range attrs {
		if a.Key == key {
			return a
		}
	}
	return nil
}

func containsFieldName(fields []domain.FlowField, name string) bool {
	for _, f := range fields {
		if f.Name == name {
			return true
		}
	}
	return false
}

func findAction(actions []domain.FlowAction, name string) (domain.FlowAction, bool) {
	for _, a := range actions {
		if a.Name == name {
			return a, true
		}
	}
	return domain.FlowAction{}, false
}

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
	set []*domain.SetUserPassword
}

func (f *fakeUserPasswordRepo) Set(_ context.Context, _ database.QueryExecutor, pw *domain.SetUserPassword) error {
	f.set = append(f.set, pw)
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

	registerCreatedCalls []domain.FlowRegisterCreatedUserInput
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

func (f *fakeAuthAttempts) RegisterCreatedUser(_ context.Context, in domain.FlowRegisterCreatedUserInput) error {
	f.registerCreatedCalls = append(f.registerCreatedCalls, in)
	return nil
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

func (f *fakePasskeyRegistration) SubmitPasskeyRegistration(_ context.Context, _ database.QueryExecutor, in domain.FlowSubmitPasskeyRegistrationInput) error {
	f.submitCalls = append(f.submitCalls, in)
	return f.submitErr
}

// flowTestWorld is the wiring a flow test exercises: resolver +
// registry + handlers + state machine, sharing the fakes the test
// inspects after a run.
type flowTestWorld struct {
	users      *fakeUserRepo
	pws        *fakeUserPasswordRepo
	ids        *idgenmock.MockGenerator
	hasher     fakeHasher
	attempts   *fakeAuthAttempts
	passkeyReg *fakePasskeyRegistration
	sm         *domain.FlowStateMachineRuntime
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
	schemas := newDefaultSchemaLoader(t)
	now := func() time.Time { return time.Unix(1700000000, 0).UTC() }
	sm := domain.NewFlowStateMachine(schemas, resolver, createUser, attempts, passkeyReg, now)

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
	assert.True(t, containsFieldName(result.Step.Fields, "email"))
	act, ok := findAction(result.Step.Actions, domain.FlowActionSubmit)
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
			"email":                   "alice@example.com",
			"x-auth-methods#password": "correct-horse-battery-staple",
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

	require.Len(t, w.pws.set, 1)
	assert.Equal(t, "hashed:correct-horse-battery-staple", w.pws.set[0].EncodedHash)

	// create_user pins the user ID and registers them on the attempt so the
	// terminal step can issue a handoff token and auto-sign-in the new user.
	assert.Equal(t, wantUserID, result.State.CollectedData.UserID)
	require.Len(t, w.attempts.registerCreatedCalls, 1)
	assert.Equal(t, wantUserID, w.attempts.registerCreatedCalls[0].UserID)
	require.Len(t, w.attempts.handoffCalls, 1)
	assert.Equal(t, "handoff_01TEST", result.HandoffToken)

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
			"email":                   "alice@example.com",
			"x-auth-methods#password": "correct-horse-battery-staple",
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

	assert.Equal(t, "user_alice", result.State.CollectedData.UserID)

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
			"email":                   "ghost@example.com",
			"x-auth-methods#password": "irrelevant",
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
			"email":                   "alice@example.com",
			"x-auth-methods#password": "correct-horse-battery-staple",
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
			"email":                   "alice@example.com",
			"x-auth-methods#password": "correct-horse-battery-staple",
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
	assert.Equal(t, "user_alice", verified.State.CollectedData.UserID)
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
	w := newFlowTestWorld(t)
	w.attempts.issueOut = domain.FlowPasskeyChallengeOutput{ChallengeID: "ch-1", Options: []byte(`{"publicKey":{}}`)}
	def := passkeyAbandonDefinition()

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

	abandoned, err := w.sm.Process(t.Context(), nil, def, issued.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
	})
	require.NoError(t, err)
	assert.Nil(t, abandoned.State.PendingChallenge, "pending challenge must be cleared when the user picks a different action")
	assert.Nil(t, abandoned.Step.Challenge, "the rendered step must not re-attach the abandoned passkey challenge")
	assert.Len(t, w.attempts.passkeyCalls, 0, "no passkey verification should run when no proof was submitted")
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
	w := newFlowTestWorld(t)
	w.attempts.identifierResult = map[string]string{
		"user1@example.com": "user_one",
		"user2@example.com": "user_two",
	}
	w.attempts.issueOut = domain.FlowPasskeyChallengeOutput{ChallengeID: "ch-1", Options: []byte(`{"publicKey":{}}`)}
	def := passkeyIdentifierLoginDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
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
	issued1, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		Fields:    map[string]any{"email": "user1@example.com"},
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued1.State.PendingChallenge)
	require.Len(t, w.attempts.identifyCalls, 1, "attempt 1 must identify user1")
	assert.Equal(t, "user1@example.com", w.attempts.identifyCalls[0].Value)
	assert.Equal(t, "user_one", issued1.State.CollectedData.UserID)

	// Attempt 1, verify leg: the assertion that comes back doesn't match any
	// credential the attempt is constrained to → server rejects.
	w.attempts.passkeyErr = domain.ErrAuthAttemptProofRejected(nil)
	rejected, err := w.sm.Process(t.Context(), nil, def, issued1.State, domain.FlowSubmitInput{
		Action:            domain.FlowActionPasskey,
		ChallengeResponse: &domain.FlowChallengeResponse{ChallengeID: "ch-1", Method: domain.FlowChallengeMethodPasskey, Proof: []byte(`{}`)},
	})
	require.NoError(t, err)
	require.NotNil(t, rejected.Step.Error)
	assert.Equal(t, "auth_attempt.passkey_invalid", *rejected.Step.Error)
	assert.Nil(t, rejected.State.PendingChallenge, "rejection clears PendingChallenge")

	// Attempt 2, issue leg: the user re-types user2's email (passkey-only)
	// and clicks "Login with passkey" again. user2 must be re-identified so
	// the new challenge is scoped to user2's credentials. Before this fix,
	// the dispatch loop skipped SubmitIdentifier whenever a previous _user_id
	// was stored, leaving the attempt bound to user1.
	w.attempts.passkeyErr = nil
	w.attempts.passkeyUserID = "user_two"
	w.attempts.issueOut = domain.FlowPasskeyChallengeOutput{ChallengeID: "ch-2", Options: []byte(`{"publicKey":{}}`)}

	issued2, err := w.sm.Process(t.Context(), nil, def, rejected.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		Fields:    map[string]any{"email": "user2@example.com"},
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued2.State.PendingChallenge, "attempt 2 must issue a fresh passkey challenge")

	require.Len(t, w.attempts.identifyCalls, 2,
		"attempt 2 must re-run SubmitIdentifier for the new email; the stored _user_id from attempt 1 must not short-circuit it")
	assert.Equal(t, "user2@example.com", w.attempts.identifyCalls[1].Value,
		"attempt 2 must dispatch the user2 identifier")
	assert.Equal(t, "user_two", issued2.State.CollectedData.UserID,
		"_user_id must be rebound to user_two so the new passkey challenge is scoped to their credentials")
}

// Re-submitting the same identifier resolves to the same user, so the
// in-flight ceremony survives. The dispatch re-runs (the auth-attempt is
// the source of truth for whether the binding should change); the resolved
// user id is the same, so PendingChallenge is preserved.
func TestFlowStateMachine_Process_PasskeyResubmitSameIdentifierKeepsPendingChallenge(t *testing.T) {
	w := newFlowTestWorld(t)
	w.attempts.identifierResult = map[string]string{"user1@example.com": "user_one"}
	w.attempts.issueOut = domain.FlowPasskeyChallengeOutput{ChallengeID: "ch-1", Options: []byte(`{"publicKey":{}}`)}
	def := passkeyIdentifierLoginDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	first, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		Fields:    map[string]any{"email": "user1@example.com"},
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.Len(t, w.attempts.identifyCalls, 1)

	// Same email re-submitted (e.g. user clicked the passkey action again
	// after dismissing the browser prompt). Same user resolved → ceremony stays.
	second, err := w.sm.Process(t.Context(), nil, def, first.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		Fields:    map[string]any{"email": "user1@example.com"},
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	assert.Len(t, w.attempts.identifyCalls, 2, "every dispatch calls SubmitIdentifier")
	require.NotNil(t, second.State.PendingChallenge, "same user resolved — ceremony survives")
	assert.Equal(t, "user_one", second.State.CollectedData.UserID)
}

// ---- CurrentPurpose + outcome flip ----

func TestFlowStateMachine_Start_InitializesCurrentPurpose(t *testing.T) {
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
			// signupDefinition only declares Register; register the other purposes
			// so Start can resolve an entry step.
			def.Purposes[domain.FlowDefinitionPurposeLogin] = "credentials"
			def.Purposes[domain.FlowDefinitionPurposeRecovery] = "credentials"

			result, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
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
	w := newFlowTestWorld(t)
	def := loginDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, start.State.CurrentPurpose)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "ghost@example.com", "x-auth-methods#password": "irrelevant"},
	})
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, result.State.Purpose, "Purpose stays pinned")
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, result.State.CurrentPurpose)
}

func TestFlowStateMachine_FlipTable_RecoveryPassthrough(t *testing.T) {
	w := newFlowTestWorld(t)
	def := loginDefinition()
	delete(def.Purposes, domain.FlowDefinitionPurposeLogin)
	def.Purposes[domain.FlowDefinitionPurposeRecovery] = "credentials"

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRecovery,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "ghost@example.com", "password": "irrelevant"},
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
	w := newFlowTestWorld(t)
	def := passkeyIdentifierDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, start.State.CurrentPurpose)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskey,
		Fields:    map[string]any{"email": "ghost@example.com"},
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	assert.Equal(t, "register", result.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, result.State.Purpose, "Purpose stays pinned")
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, result.State.CurrentPurpose,
		"early-passkey dispatch must flip CurrentPurpose on user_not_found, parity with the non-passkey path")
	assert.Nil(t, result.State.PendingChallenge, "passkey challenge must not be issued when identifier dispatch already produced an outcome")
	assert.Empty(t, w.attempts.issueCalls, "IssuePasskeyChallenge must be skipped when the user wasn't resolved")
	require.Len(t, w.attempts.identifyCalls, 1, "identifier dispatch ran exactly once")
	assert.Equal(t, "ghost@example.com", w.attempts.identifyCalls[0].Value)
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
	w := newFlowTestWorld(t)
	def := loginNoUserNotFoundDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	result, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
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
	w := newFlowTestWorld(t)
	w.attempts.identifierResult = map[string]string{
		"alice@example.com": "user_alice",
	}
	def := loginNoUserNotFoundDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Typo: dispatch returns user_not_found, no transition wired,
	// engine surfaces a step error and the user stays on credentials.
	typo, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "alic@example.com", "x-auth-methods#password": "irrelevant"},
	})
	require.NoError(t, err)
	require.Equal(t, "credentials", typo.State.CurrentStep)
	require.NotNil(t, typo.Step.Error)
	require.Equal(t, domain.FlowDefinitionPurposeLogin, typo.State.CurrentPurpose,
		"phantom flip on the typo would wedge the retry below")

	// Retry with the correct (known) email: still in login mode, so
	// identifier resolves, password verifies, and the user signs in.
	result, err := w.sm.Process(t.Context(), nil, def, typo.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "alice@example.com", "x-auth-methods#password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	assert.Equal(t, "done", result.State.CurrentStep)
	assert.Equal(t, "user_alice", result.State.CollectedData.UserID)
	assert.NotEmpty(t, result.HandoffToken, "handoff issued for completed sign-in")
}

func TestFlowState_JSONRoundTrip_PreservesCurrentPurpose(t *testing.T) {
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
	w := newFlowTestWorld(t)
	def := multiStepSignupDefinition()

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeRegister,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	afterProfile, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"email": "fresh@example.com"},
	})
	require.NoError(t, err)
	assert.Equal(t, "set-password", afterProfile.State.CurrentStep)
	assert.Equal(t, domain.FlowDefinitionPurposeRegister, afterProfile.State.CurrentPurpose)
	require.Len(t, w.attempts.identifyCalls, 1)
	assert.Empty(t, w.attempts.passwordCalls)

	afterPassword, err := w.sm.Process(t.Context(), nil, def, afterProfile.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	assert.Equal(t, "create", afterPassword.State.CurrentStep)
	assert.Empty(t, w.attempts.passwordCalls, "register mode never verifies password")

	done, err := w.sm.Process(t.Context(), nil, def, afterPassword.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
	})
	require.NoError(t, err)
	assert.Equal(t, "done", done.State.CurrentStep)
	require.Len(t, w.users.created, 1)
	// create_user reads identifier from CollectedData; email isn't re-sent.
	emailAttr := findAttribute(w.users.created[0].Attributes, "email")
	require.NotNil(t, emailAttr)
	assert.Equal(t, "fresh@example.com", emailAttr.Value)
}

// Register entry, identifier already exists → user_already_exists +
// flip to login.
func TestFlowDispatch_RegisterEntry_IdentifierAlreadyExists_Flips(t *testing.T) {
	w := newFlowTestWorld(t)
	w.attempts.identifierResult = map[string]string{"taken@example.com": "user_existing"}
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
	assert.Equal(t, domain.FlowDefinitionPurposeLogin, result.State.CurrentPurpose)
	assert.Equal(t, "done", result.State.CurrentStep)
}

// Worked example C: login entry, unknown email → flip + create_user runs.
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
		Fields: map[string]any{"x-auth-methods#password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	assert.Equal(t, "done", done.State.CurrentStep)
	require.Len(t, w.users.created, 1)
	assert.Empty(t, w.attempts.passwordCalls)
	// Email collected on the identify step survives into create_user.
	emailAttr := findAttribute(w.users.created[0].Attributes, "email")
	require.NotNil(t, emailAttr)
	assert.Equal(t, "ghost@example.com", emailAttr.Value)
}

// Worked example C variant: register entry, identifier exists → flip
// to login + signin-password verifies.
func TestFlowDispatch_CombinedFlow_RegisterKnownEmail_FlipsToSignin(t *testing.T) {
	w := newFlowTestWorld(t)
	w.attempts.identifierResult = map[string]string{"alice@example.com": "user_alice"}
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
		Fields: map[string]any{"x-auth-methods#password": "correct-horse-battery-staple"},
	})
	require.NoError(t, err)
	assert.Equal(t, "done", done.State.CurrentStep)
	require.Len(t, w.attempts.passwordCalls, 1)
}

// Worked example D: recovery identifies but never verifies password.
func TestFlowDispatch_Recovery_IdentifierResolvedPasswordNotDispatched(t *testing.T) {
	w := newFlowTestWorld(t)
	w.attempts.identifierResult = map[string]string{"alice@example.com": "user_alice"}
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
	assert.Equal(t, domain.FlowDefinitionPurposeRecovery, afterIdentify.State.CurrentPurpose)
	require.Len(t, w.attempts.identifyCalls, 1)

	_, err = w.sm.Process(t.Context(), nil, def, afterIdentify.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{"x-auth-methods#password": "fresh-secret"},
	})
	require.NoError(t, err)
	assert.Empty(t, w.attempts.passwordCalls)
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
	start.State.CollectedData.UserID = "user_alice"

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
	start.State.CollectedData.UserID = "user_alice"

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

// TestFlowStateMachine_Process_PasskeyRegisterGeneratesUserID verifies that
// when no user is identified yet (passkey-only registration path), the state
// machine generates a provisional user ID and issues the challenge successfully.
func TestFlowStateMachine_Process_PasskeyRegisterGeneratesUserID(t *testing.T) {
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
	// No user ID seeded — the state machine should generate one.

	issued, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action:    domain.FlowActionPasskeyRegister,
		PasskeyRP: &domain.FlowPasskeyRP{RPID: "example.com", Origins: []string{"https://example.com"}},
	})
	require.NoError(t, err)
	require.NotNil(t, issued.Step.Challenge)
	// The provisional user ID should have been generated and passed to the service.
	require.Len(t, w.passkeyReg.issueCalls, 1)
	assert.NotEmpty(t, w.passkeyReg.issueCalls[0].UserID)
	// The generated ID should be stored in CollectedData for use in the verify phase.
	assert.Equal(t, w.passkeyReg.issueCalls[0].UserID, issued.State.CollectedData.UserID)
}

// TestFlowStateMachine_Start_PreservesActionOrder pins ADR 021: the rendered
// step's Actions list reflects the definition order, not Go map iteration.
func TestFlowStateMachine_Start_PreservesActionOrder(t *testing.T) {
	w := newFlowTestWorld(t)
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
					{Name: domain.FlowActionPasskey, Kind: domain.FlowActionKindPasskey},
					{Name: domain.FlowActionSubmit, Kind: domain.FlowActionKindSubmit, Primary: true},
					{Name: "register", Kind: domain.FlowActionKindSubmit},
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

	result, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
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
					{Name: "back", Kind: domain.FlowActionKindNavigate},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "done"},
					"back":                  {Target: "landing"},
				},
			},
			{Name: "landing", Complete: &show},
			{Name: "done", Complete: &show},
		},
	}

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	require.NoError(t, err)

	// Empty fields would fail validation under a submit action; navigate
	// must skip validation and follow the transition.
	result, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: "back",
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
