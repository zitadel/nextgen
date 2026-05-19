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
	users := &fakeUserRepo{}
	pws := &fakeUserPasswordRepo{}
	ids := &fakeIDGen{id: "01TEST"}
	hasher := fakeHasher{}

	createUser := domain.NewFlowCreateUserHandler(ids, users, pws, hasher)
	resolver := newDefaultResolver(t)
	now := func() time.Time { return time.Unix(1700000000, 0).UTC() }
	sm := domain.NewFlowStateMachine(resolver, createUser, now)

	return &flowTestWorld{users: users, pws: pws, ids: ids, hasher: hasher, sm: sm}
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
