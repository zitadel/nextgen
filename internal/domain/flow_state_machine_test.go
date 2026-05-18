package domain_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// fakeIDGen returns a fixed prefixed id so terminal-state checks can
// assert the recorded user id exactly.
type fakeIDGen struct {
	id  string
	err error
}

func (g *fakeIDGen) New(prefix string) (string, error) {
	if g.err != nil {
		return "", g.err
	}
	return prefix + "_" + g.id, nil
}

// fakeHasher is a prefix-based password hasher: Hash returns
// "hashed:"+plain, Verify reports whether the encoded form matches that
// shape. Trivial to reason about in tests.
type fakeHasher struct{}

func (fakeHasher) Hash(plain string) (string, error) { return "hashed:" + plain, nil }

func (fakeHasher) Verify(plain, encoded string) (bool, error) {
	return encoded == "hashed:"+plain, nil
}

// captureCondition is a no-op condition used by the fake repositories.
// Tests never inspect the condition graph the handler builds; the fakes
// route off values captured when their condition constructors are
// called.
type captureCondition struct{ tag string }

func (c *captureCondition) Write(*database.StatementBuilder)             {}
func (c *captureCondition) Matches(any) bool                             { return false }
func (c *captureCondition) String() string                               { return c.tag }
func (c *captureCondition) IsRestrictingColumn(database.Column) bool     { return false }

// fakeUserRepo backs both flowUserReader and flowUserWriter. It stores
// users keyed by the most recent identifier value captured via
// AttributesCondition.
type fakeUserRepo struct {
	usersByIdentifier map[string]*domain.User
	captureID         string
	created           []*domain.CreateUser
}

func newFakeUserRepo() *fakeUserRepo {
	return &fakeUserRepo{usersByIdentifier: map[string]*domain.User{}}
}

func (f *fakeUserRepo) ProjectIDCondition(string) database.Condition {
	return &captureCondition{tag: "project_id"}
}

func (f *fakeUserRepo) AttributesCondition(attributes []domain.Attribute) database.Condition {
	if len(attributes) > 0 {
		if s, ok := attributes[0].Value.(string); ok {
			f.captureID = s
		}
	}
	return &captureCondition{tag: "attributes"}
}

func (f *fakeUserRepo) Get(_ context.Context, _ database.QueryExecutor, _ ...database.QueryOption) (*domain.User, error) {
	u, ok := f.usersByIdentifier[f.captureID]
	if !ok {
		return nil, database.NewNoRowFoundError(nil)
	}
	return u, nil
}

func (f *fakeUserRepo) Create(_ context.Context, _ database.QueryExecutor, user *domain.CreateUser) error {
	f.created = append(f.created, user)
	return nil
}

// fakeUserPasswordRepo backs both flowUserPasswordReader and
// flowUserPasswordWriter. UniqueCondition captures the user id so Get
// can resolve the stored hash; Create records the persisted row.
type fakeUserPasswordRepo struct {
	hashByUserID  map[string]string
	captureUserID string
	created       []*domain.CreateUserPassword
}

func newFakeUserPasswordRepo() *fakeUserPasswordRepo {
	return &fakeUserPasswordRepo{hashByUserID: map[string]string{}}
}

func (f *fakeUserPasswordRepo) UniqueCondition(_, userID string) database.Condition {
	f.captureUserID = userID
	return &captureCondition{tag: "user_password_unique"}
}

func (f *fakeUserPasswordRepo) Get(_ context.Context, _ database.QueryExecutor, _ ...database.QueryOption) (*domain.UserPassword, error) {
	hash, ok := f.hashByUserID[f.captureUserID]
	if !ok {
		return nil, database.NewNoRowFoundError(nil)
	}
	return &domain.UserPassword{UserID: f.captureUserID, EncodedHash: hash}, nil
}

func (f *fakeUserPasswordRepo) Create(_ context.Context, _ database.QueryExecutor, pw *domain.CreateUserPassword) error {
	f.created = append(f.created, pw)
	f.hashByUserID[pw.UserID] = pw.EncodedHash
	return nil
}

// flowTestWorld is the wiring a flow test exercises: resolver +
// registry + handlers + state machine, sharing the fakes the test
// inspects after a run.
type flowTestWorld struct {
	users  *fakeUserRepo
	pws    *fakeUserPasswordRepo
	ids    *fakeIDGen
	hasher fakeHasher
	sm     *domain.FlowStateMachineRuntime
}

func newFlowTestWorld(t *testing.T) *flowTestWorld {
	t.Helper()
	users := newFakeUserRepo()
	pws := newFakeUserPasswordRepo()
	ids := &fakeIDGen{id: "01TEST"}
	hasher := fakeHasher{}

	registry := domain.NewFlowOnSuccessRegistry()
	if err := registry.Register(domain.FlowOnSuccessCreateUser, domain.NewFlowCreateUserHandler(ids, users, pws, hasher)); err != nil {
		t.Fatalf("register create_user: %v", err)
	}
	if err := registry.Register(domain.FlowOnSuccessVerifyCredentials, domain.NewFlowVerifyCredentialsHandler(users, pws, hasher)); err != nil {
		t.Fatalf("register verify_credentials: %v", err)
	}

	resolver := newDefaultResolver(t)
	now := func() time.Time { return time.Unix(1700000000, 0).UTC() }
	sm := domain.NewFlowStateMachine(resolver, registry, now)

	return &flowTestWorld{users: users, pws: pws, ids: ids, hasher: hasher, sm: sm}
}

// signupDefinition builds a single-step signup flow: a `credentials`
// step with email+password, on_success=create_user, transitioning to
// the `done` terminal on `submit`.
func signupDefinition() *domain.FlowDefinition {
	return &domain.FlowDefinition{
		ProjectID: testProjectID,
		ID:        "def-signup",
		Purposes: []domain.FlowDefinitionPurposeEntry{
			{Purpose: domain.FlowDefinitionPurposeRegister, InitialStep: "credentials"},
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:      "credentials",
				Type:      domain.FlowStepTypeCredential,
				OnSuccess: domain.FlowOnSuccessCreateUser,
				Config: map[string]any{
					"fields": []any{"email", "password"},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit: {Target: "done"},
				},
			},
			{
				Name: "done",
				Type: domain.FlowStepTypeComplete,
				Config: map[string]any{
					"complete": "show",
				},
			},
		},
	}
}

// loginDefinition builds a single-step login flow: `credentials` with
// email+password, on_success=verify_credentials, transitioning on
// `submit` to `done` and on `user_not_found` to a `no_account`
// terminal.
func loginDefinition() *domain.FlowDefinition {
	return &domain.FlowDefinition{
		ProjectID: testProjectID,
		ID:        "def-login",
		Purposes: []domain.FlowDefinitionPurposeEntry{
			{Purpose: domain.FlowDefinitionPurposeLogin, InitialStep: "credentials"},
		},
		Steps: []domain.FlowDefinitionStep{
			{
				Name:      "credentials",
				Type:      domain.FlowStepTypeCredential,
				OnSuccess: domain.FlowOnSuccessVerifyCredentials,
				Config: map[string]any{
					"fields": []any{"email", "password"},
				},
				Transitions: map[string]domain.FlowStepTransition{
					domain.FlowActionSubmit:                  {Target: "done"},
					domain.FlowImplicitOutcomeUserNotFound:   {Target: "no_account"},
				},
			},
			{
				Name: "done",
				Type: domain.FlowStepTypeComplete,
				Config: map[string]any{
					"complete": "show",
				},
			},
			{
				Name: "no_account",
				Type: domain.FlowStepTypeComplete,
				Config: map[string]any{
					"complete": "show",
				},
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
	if err != nil {
		t.Fatalf("Start error: %v", err)
	}
	if result.Step == nil || result.Step.Name != "credentials" {
		t.Fatalf("Start initial step = %+v, want credentials", result.Step)
	}
	if result.State.CurrentStep != "credentials" {
		t.Fatalf("State.CurrentStep = %q, want credentials", result.State.CurrentStep)
	}
	if result.State.ProjectID != testProjectID {
		t.Errorf("State.ProjectID = %q, want %q", result.State.ProjectID, testProjectID)
	}
	if result.State.UserSchemaURL != defaultSchemaURL {
		t.Errorf("State.UserSchemaURL = %q, want %q", result.State.UserSchemaURL, defaultSchemaURL)
	}
	if _, ok := result.Step.Fields["email"]; !ok {
		t.Errorf("Step.Fields missing email; got %v", result.Step.Fields)
	}
	if act, ok := result.Step.Actions[domain.FlowActionSubmit]; !ok || !act.Primary {
		t.Errorf("Step.Actions[submit] = %+v, want primary=true", act)
	}
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
	if err != nil {
		t.Fatalf("Start error: %v", err)
	}

	result, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":    "alice@example.com",
			"password": "correct-horse-battery-staple",
		},
	})
	if err != nil {
		t.Fatalf("Process error: %v", err)
	}
	if result.Step == nil || result.Step.Name != "done" {
		t.Fatalf("Process step = %+v, want done", result.Step)
	}
	if result.Step.Complete == nil || *result.Step.Complete != domain.FlowStepCompleteShow {
		t.Errorf("Step.Complete = %v, want show", result.Step.Complete)
	}
	if len(w.users.created) != 1 {
		t.Fatalf("user repo Create called %d times, want 1", len(w.users.created))
	}
	createdUser := w.users.created[0]
	wantUserID := "user_01TEST"
	if createdUser.ID != wantUserID {
		t.Errorf("created user ID = %q, want %q", createdUser.ID, wantUserID)
	}
	if len(w.pws.created) != 1 {
		t.Fatalf("password repo Create called %d times, want 1", len(w.pws.created))
	}
	if w.pws.created[0].EncodedHash != "hashed:correct-horse-battery-staple" {
		t.Errorf("password EncodedHash = %q, want hashed:correct-horse-battery-staple", w.pws.created[0].EncodedHash)
	}
	if got := result.State.CollectedData[domain.FlowCollectedUserIDKey]; got != wantUserID {
		t.Errorf("CollectedData[%s] = %v, want %q", domain.FlowCollectedUserIDKey, got, wantUserID)
	}
}

func TestFlowStateMachine_Process_LoginHappyPath(t *testing.T) {
	w := newFlowTestWorld(t)
	def := loginDefinition()
	w.users.usersByIdentifier["alice@example.com"] = &domain.User{ID: "user_existing", ProjectID: testProjectID}
	w.pws.hashByUserID["user_existing"] = "hashed:hunter2hunter2"

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	if err != nil {
		t.Fatalf("Start error: %v", err)
	}

	result, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":    "alice@example.com",
			"password": "hunter2hunter2",
		},
	})
	if err != nil {
		t.Fatalf("Process error: %v", err)
	}
	if result.Step == nil || result.Step.Name != "done" {
		t.Fatalf("Process step = %+v, want done", result.Step)
	}
	if got := result.State.CollectedData[domain.FlowCollectedUserIDKey]; got != "user_existing" {
		t.Errorf("CollectedData[%s] = %v, want user_existing", domain.FlowCollectedUserIDKey, got)
	}
}

func TestFlowStateMachine_Process_LoginInvalidPasswordKeepsStep(t *testing.T) {
	w := newFlowTestWorld(t)
	def := loginDefinition()
	w.users.usersByIdentifier["alice@example.com"] = &domain.User{ID: "user_existing", ProjectID: testProjectID}
	w.pws.hashByUserID["user_existing"] = "hashed:hunter2hunter2"

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	if err != nil {
		t.Fatalf("Start error: %v", err)
	}

	result, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":    "alice@example.com",
			"password": "wrong-pw-but-long-enough",
		},
	})
	if err != nil {
		t.Fatalf("Process error: %v", err)
	}
	if result.Step == nil || result.Step.Name != "credentials" {
		t.Fatalf("Process step = %+v, want stay on credentials", result.Step)
	}
	if result.Step.Error == nil || *result.Step.Error != domain.FlowImplicitOutcomeInvalidCredentials {
		t.Errorf("Step.Error = %v, want %q", result.Step.Error, domain.FlowImplicitOutcomeInvalidCredentials)
	}
	if result.Step.Complete != nil {
		t.Errorf("Step.Complete = %v, want nil (still on credentials)", result.Step.Complete)
	}
}

func TestFlowStateMachine_Process_LoginUnknownIdentifierRoutesUserNotFound(t *testing.T) {
	w := newFlowTestWorld(t)
	def := loginDefinition()
	// No user seeded — repo will return NoRowFoundError.

	start, err := w.sm.Start(t.Context(), nil, domain.FlowStartInput{
		Definition:    def,
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Session:       domain.FlowSessionRef{ID: "sess-1", Version: 1},
		UserSchemaURL: defaultSchemaURL,
	})
	if err != nil {
		t.Fatalf("Start error: %v", err)
	}

	result, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":    "ghost@example.com",
			"password": "doesnt-matter-but-long-enough",
		},
	})
	if err != nil {
		t.Fatalf("Process error: %v", err)
	}
	if result.Step == nil || result.Step.Name != "no_account" {
		t.Fatalf("Process step = %+v, want no_account", result.Step)
	}
	if result.Step.Complete == nil || *result.Step.Complete != domain.FlowStepCompleteShow {
		t.Errorf("Step.Complete = %v, want show", result.Step.Complete)
	}
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
	if err != nil {
		t.Fatalf("Start error: %v", err)
	}

	result, err := w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":    "not-an-email",
			"password": "correct-horse-battery-staple",
		},
	})
	if err != nil {
		t.Fatalf("Process error: %v", err)
	}
	if result.Step == nil || result.Step.Name != "credentials" {
		t.Fatalf("Process step = %+v, want stay on credentials", result.Step)
	}
	if result.Step.Error == nil || !strings.Contains(*result.Step.Error, "email") {
		t.Errorf("Step.Error = %v, want a validation error mentioning email", result.Step.Error)
	}
	if len(w.users.created) != 0 {
		t.Errorf("user repo Create called %d times on validation error, want 0", len(w.users.created))
	}
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
	if err != nil {
		t.Fatalf("Start error: %v", err)
	}

	_, err = w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: domain.FlowActionSubmit,
		Fields: map[string]any{
			"email":    "alice@example.com",
			"password": "correct-horse-battery-staple",
		},
	})
	if !errors.Is(err, domain.ErrIntegrity) {
		t.Fatalf("Process err = %v, want ErrIntegrity", err)
	}
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
	if err != nil {
		t.Fatalf("Start error: %v", err)
	}

	_, err = w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action: "not_declared",
		Fields: map[string]any{
			"email":    "alice@example.com",
			"password": "correct-horse-battery-staple",
		},
	})
	if !errors.Is(err, domain.ErrInvalidAction) {
		t.Fatalf("Process err = %v, want ErrInvalidAction", err)
	}
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
	if err != nil {
		t.Fatalf("Start error: %v", err)
	}

	_, err = w.sm.Process(t.Context(), nil, def, start.State, domain.FlowSubmitInput{
		Action:      domain.FlowActionSubmit,
		SSOProvider: &domain.FlowSSOProviderRef{ID: "google"},
	})
	if !errors.Is(err, domain.ErrUnsupported) {
		t.Fatalf("Process err = %v, want ErrUnsupported", err)
	}
}
