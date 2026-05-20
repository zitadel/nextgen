package service_test

import (
	"context"
	"errors"
	"strconv"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// fakeStateMachine is a hand-rolled [domain.FlowStateMachine] that
// captures inputs and returns the result the test pre-loaded.
type fakeStateMachine struct {
	startResult   domain.FlowStepResult
	startErr      error
	processResult domain.FlowStepResult
	processErr    error
	renderResult  domain.FlowStepResult
	renderErr     error

	gotStartInput  domain.FlowStartInput
	gotSubmitInput domain.FlowSubmitInput
	gotProcessDef  *domain.FlowDefinition
	gotRenderState *domain.FlowState
}

func (f *fakeStateMachine) Start(_ context.Context, _ database.QueryExecutor, in domain.FlowStartInput) (domain.FlowStepResult, error) {
	f.gotStartInput = in
	return f.startResult, f.startErr
}

func (f *fakeStateMachine) Process(_ context.Context, _ database.QueryExecutor, def *domain.FlowDefinition, _ *domain.FlowState, in domain.FlowSubmitInput) (domain.FlowStepResult, error) {
	f.gotProcessDef = def
	f.gotSubmitInput = in
	return f.processResult, f.processErr
}

func (f *fakeStateMachine) Render(_ context.Context, _ database.QueryExecutor, _ *domain.FlowDefinition, state *domain.FlowState) (domain.FlowStepResult, error) {
	f.gotRenderState = state
	return f.renderResult, f.renderErr
}

// stubIDGen returns deterministic IDs prefixed by their resource type.
type stubIDGen struct {
	calls int
}

func (s *stubIDGen) New(prefix string) (string, error) {
	s.calls++
	return prefix + "_" + strconv.Itoa(s.calls), nil
}

func TestFlowService_Start_MintsFlowAndSessionIDs(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	def.UserSchema = "https://example.com/user.json"

	state := &domain.FlowState{ProjectID: def.ProjectID}
	sm := &fakeStateMachine{startResult: domain.FlowStepResult{State: state, Step: &domain.FlowStep{Name: "start"}}}
	ids := &stubIDGen{}

	svc := service.NewFlowService(stubPool(), nil, sm, ids)

	res, err := svc.Start(t.Context(), service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeLogin,
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if res.State == nil || res.State.ID == "" {
		t.Fatal("flow id was not minted")
	}
	if sm.gotStartInput.Session.ID == "" {
		t.Fatal("session id was not minted")
	}
	if sm.gotStartInput.UserSchemaURL != def.UserSchema {
		t.Errorf("UserSchemaURL = %q, want %q", sm.gotStartInput.UserSchemaURL, def.UserSchema)
	}
}

func TestFlowService_Start_PassesRedirectURIThrough(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	state := &domain.FlowState{ProjectID: def.ProjectID}
	sm := &fakeStateMachine{startResult: domain.FlowStepResult{State: state, Step: &domain.FlowStep{}}}

	svc := service.NewFlowService(stubPool(), nil, sm, &stubIDGen{})

	redirect := "https://rp.example.com/cb"
	if _, err := svc.Start(t.Context(), service.StartFlowRequest{
		Definition:  def,
		Purpose:     domain.FlowDefinitionPurposeLogin,
		RedirectURI: &redirect,
	}); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if sm.gotStartInput.RedirectURI == nil || *sm.gotStartInput.RedirectURI != redirect {
		t.Errorf("RedirectURI = %v, want %q", sm.gotStartInput.RedirectURI, redirect)
	}
}

func TestFlowService_Start_PreservesProvidedSessionID(t *testing.T) {
	def := newDef("reauth", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeReauth)
	state := &domain.FlowState{ProjectID: def.ProjectID}
	sm := &fakeStateMachine{startResult: domain.FlowStepResult{State: state, Step: &domain.FlowStep{}}}

	svc := service.NewFlowService(stubPool(), nil, sm, &stubIDGen{})

	sessionID := "sess_explicit"
	if _, err := svc.Start(t.Context(), service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeReauth,
		SessionID:  &sessionID,
	}); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if sm.gotStartInput.Session.ID != sessionID {
		t.Errorf("Session.ID = %q, want %q", sm.gotStartInput.Session.ID, sessionID)
	}
}

func TestFlowService_Start_PropagatesStateMachineError(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	sm := &fakeStateMachine{startErr: errors.New("boom")}

	svc := service.NewFlowService(stubPool(), nil, sm, &stubIDGen{})

	_, err := svc.Start(t.Context(), service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeLogin,
	})
	if err == nil || err.Error() != "boom" {
		t.Fatalf("Start err = %v, want boom", err)
	}
}

func TestFlowService_Submit_RefetchesDefinitionAndCallsProcess(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubGetFlowDefinition(t, def)
	processedState := &domain.FlowState{ID: "flow_1"}
	sm := &fakeStateMachine{processResult: domain.FlowStepResult{State: processedState, Step: &domain.FlowStep{Name: "next"}}}

	svc := service.NewFlowService(stubPool(), repo, sm, &stubIDGen{})

	state := &domain.FlowState{
		ID:           "flow_1",
		ProjectID:    def.ProjectID,
		FlowProgress: domain.FlowProgress{DefinitionID: def.ID},
	}
	if _, err := svc.Submit(t.Context(), service.SubmitFlowRequest{
		State:  state,
		Action: "submit",
	}); err != nil {
		t.Fatalf("Submit: %v", err)
	}
	if sm.gotProcessDef == nil || sm.gotProcessDef.ID != def.ID {
		t.Fatalf("Process was not called with refetched definition")
	}
	if sm.gotSubmitInput.Action != "submit" {
		t.Errorf("Action = %q, want submit", sm.gotSubmitInput.Action)
	}
}

func TestFlowService_GetStep_CallsRender(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubGetFlowDefinition(t, def)
	state := &domain.FlowState{
		ID:           "flow_1",
		ProjectID:    def.ProjectID,
		FlowProgress: domain.FlowProgress{DefinitionID: def.ID},
	}
	sm := &fakeStateMachine{renderResult: domain.FlowStepResult{State: state, Step: &domain.FlowStep{Name: "identify"}}}

	svc := service.NewFlowService(stubPool(), repo, sm, &stubIDGen{})

	res, err := svc.GetStep(t.Context(), service.GetFlowStepRequest{State: state})
	if err != nil {
		t.Fatalf("GetStep: %v", err)
	}
	if sm.gotRenderState != state {
		t.Errorf("Render was called with %p, want %p", sm.gotRenderState, state)
	}
	if res.Step == nil || res.Step.Name != "identify" {
		t.Errorf("Step = %+v, want name identify", res.Step)
	}
}
