package service_test

import (
	"context"
	"errors"
	"testing"

	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// stubPool returns nil typed as database.Pool. The mock repository does not
// invoke any methods on it, so the value is opaque — it only satisfies the
// service constructor signature.
func stubPool() database.Pool { return nil }

// stubListFlowDefinitions wires the mock's ListFlowDefinitions to filter the
// given slice in-memory the same way the storage layer does. Tests stay focused
// on the Resolve algorithm without re-stating expected filter sets.
// Returns the mock so the caller can attach additional expectations.
func stubListFlowDefinitions(t *testing.T, defs []*domain.FlowDefinition) *domainmock.MockFlowDefinitionRepository {
	t.Helper()
	ctrl := gomock.NewController(t)
	repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
	repo.EXPECT().
		ListFlowDefinitions(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, _ database.QueryExecutor, _ string, opts ...domain.FlowDefinitionListOption) ([]*domain.FlowDefinition, error) {
			o := domain.ApplyFlowDefinitionListOptions(opts)
			out := make([]*domain.FlowDefinition, 0, len(defs))
			for _, def := range defs {
				if o.Name != nil && def.Name != *o.Name {
					continue
				}
				if o.Status != nil && def.Status != *o.Status {
					continue
				}
				if o.Purpose != nil && !hasPurpose(def, *o.Purpose) {
					continue
				}
				if o.SchemaVersion != nil && def.SchemaVersion != *o.SchemaVersion {
					continue
				}
				out = append(out, def)
			}
			return out, nil
		}).
		AnyTimes()
	return repo
}

func hasPurpose(def *domain.FlowDefinition, purpose domain.FlowDefinitionPurpose) bool {
	for _, p := range def.Purposes {
		if p.Purpose == purpose {
			return true
		}
	}
	return false
}

func ptr[T any](v T) *T { return &v }

func newDef(name, version string, audience domain.FlowDefinitionAudience, purposes ...domain.FlowDefinitionPurpose) *domain.FlowDefinition {
	entries := make([]domain.FlowDefinitionPurposeEntry, len(purposes))
	for i, p := range purposes {
		entries[i] = domain.FlowDefinitionPurposeEntry{Purpose: p, InitialStep: "start"}
	}
	return &domain.FlowDefinition{
		ProjectID:     "proj",
		ID:            name + "-" + version,
		Name:          name,
		SchemaVersion: version,
		Status:        domain.FlowDefinitionStatusActive,
		Purposes:      entries,
		Audience:      audience,
	}
}

func TestResolve_ResolveByName_ExactVersion(t *testing.T) {
	want := newDef("login", "1.2.3", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	other := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{other, want})

	got, err := service.NewFlowService(stubPool(), repo, nil, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID:     "proj",
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Name:          ptr("login"),
		SchemaVersion: ptr("1.2.3"),
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got != want {
		t.Fatalf("Resolve = %v, want %v", got, want)
	}
}

func TestResolve_ResolveByName_FiltersWithRequestedOptions(t *testing.T) {
	def := newDef("login", "1.2.3", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)

	ctrl := gomock.NewController(t)
	repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
	repo.EXPECT().
		ListFlowDefinitions(gomock.Any(), gomock.Any(), "proj", gomock.Any()).
		DoAndReturn(func(_ context.Context, _ database.QueryExecutor, _ string, opts ...domain.FlowDefinitionListOption) ([]*domain.FlowDefinition, error) {
			o := domain.ApplyFlowDefinitionListOptions(opts)
			if o.Name == nil || *o.Name != "login" {
				t.Errorf("expected Name=login, got %+v", o.Name)
			}
			if o.Status == nil || *o.Status != domain.FlowDefinitionStatusActive {
				t.Errorf("expected Status=active, got %+v", o.Status)
			}
			if o.SchemaVersion == nil || *o.SchemaVersion != "1.2.3" {
				t.Errorf("expected SchemaVersion=1.2.3, got %+v", o.SchemaVersion)
			}
			return []*domain.FlowDefinition{def}, nil
		})

	_, err := service.NewFlowService(stubPool(), repo, nil, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID:     "proj",
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Name:          ptr("login"),
		SchemaVersion: ptr("1.2.3"),
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
}

func TestResolve_ResolveByName_LatestActiveWhenVersionNil(t *testing.T) {
	v1 := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	v2 := newDef("login", "2.4.1", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	v15 := newDef("login", "1.5.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{v1, v2, v15})

	got, err := service.NewFlowService(stubPool(), repo, nil, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Name:      ptr("login"),
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got != v2 {
		t.Fatalf("Resolve = %v, want %v (latest version)", got, v2)
	}
}

func TestResolve_ResolveByName_NotFound(t *testing.T) {
	repo := stubListFlowDefinitions(t, nil)

	_, err := service.NewFlowService(stubPool(), repo, nil, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Name:      ptr("missing"),
	})
	if !errors.Is(err, domain.ErrFlowDefinitionNotFound()) {
		t.Fatalf("Resolve err = %v, want ErrFlowNotFound", err)
	}
}

func TestResolve_ResolveByName_PurposeMismatch(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{def})

	_, err := service.NewFlowService(stubPool(), repo, nil, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeRegister,
		Name:      ptr("login"),
	})
	if !errors.Is(err, domain.ErrFlowDefinitionPurposeMismatch()) {
		t.Fatalf("Resolve err = %v, want ErrPurposeMismatch", err)
	}
}

func TestResolve_ResolveByAudience_ReturnsFirstMatchingPurpose(t *testing.T) {
	first := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	second := newDef("alt", "1.0.0", domain.FlowDefinitionAudience{AppIDs: []string{"app-1"}}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{first, second})

	got, err := service.NewFlowService(stubPool(), repo, nil, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got != first {
		t.Fatalf("Resolve = %v, want first definition", got)
	}
}

func TestResolve_ResolveByAudience_NoMatch(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{def})

	_, err := service.NewFlowService(stubPool(), repo, nil, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeRegister,
	})
	if !errors.Is(err, domain.ErrFlowDefinitionNotFound()) {
		t.Fatalf("Resolve err = %v, want ErrFlowNotFound", err)
	}
}

func TestResolve_ResolveByAudience_ExactVersionFiltersOlder(t *testing.T) {
	v1 := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	v2 := newDef("login", "2.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{v1, v2})

	got, err := service.NewFlowService(stubPool(), repo, nil, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID:     "proj",
		Purpose:       domain.FlowDefinitionPurposeLogin,
		SchemaVersion: ptr("1.0.0"),
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got != v1 {
		t.Fatalf("Resolve = %v, want v1 (exact match)", got)
	}
}

func TestResolve_ResolveByAudience_RepoErrorPropagates(t *testing.T) {
	sentinel := errors.New("boom")
	ctrl := gomock.NewController(t)
	repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
	repo.EXPECT().
		ListFlowDefinitions(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
		Return(nil, sentinel)

	_, err := service.NewFlowService(stubPool(), repo, nil, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("Resolve err = %v, want boom", err)
	}
}

// fakeStateMachine captures every call so the service-level tests can
// assert the inputs the service threaded into the state machine without
// running the real runtime (which needs a schema resolver, a registry,
// and a database client).
type fakeStateMachine struct {
	startIn  domain.FlowStartInput
	startOut domain.FlowStepResult
	startErr error

	submitDef    *domain.FlowDefinition
	submitState  *domain.FlowState
	submitIn     domain.FlowSubmitInput
	submitOut    domain.FlowStepResult
	submitErr    error

	renderDef   *domain.FlowDefinition
	renderState *domain.FlowState
	renderOut   domain.FlowStepResult
	renderErr   error
}

func (f *fakeStateMachine) Start(_ context.Context, _ database.QueryExecutor, in domain.FlowStartInput) (domain.FlowStepResult, error) {
	f.startIn = in
	return f.startOut, f.startErr
}

func (f *fakeStateMachine) Process(_ context.Context, _ database.QueryExecutor, def *domain.FlowDefinition, state *domain.FlowState, in domain.FlowSubmitInput) (domain.FlowStepResult, error) {
	f.submitDef = def
	f.submitState = state
	f.submitIn = in
	return f.submitOut, f.submitErr
}

func (f *fakeStateMachine) Render(_ context.Context, _ database.QueryExecutor, def *domain.FlowDefinition, state *domain.FlowState) (domain.FlowStepResult, error) {
	f.renderDef = def
	f.renderState = state
	return f.renderOut, f.renderErr
}

// scriptedIDGen returns the queued ids in order so a test can pin both
// the flow id and the session id Start mints.
type scriptedIDGen struct {
	ids []string
	idx int
	err error
}

func (g *scriptedIDGen) New(prefix string) (string, error) {
	if g.err != nil {
		return "", g.err
	}
	if g.idx >= len(g.ids) {
		return prefix + "_unscripted", nil
	}
	out := prefix + "_" + g.ids[g.idx]
	g.idx++
	return out, nil
}

func TestStart_MintsHandlesAndCarriesDefinitionUserSchema(t *testing.T) {
	def := &domain.FlowDefinition{
		ProjectID:  "proj",
		ID:         "def-1",
		UserSchema: "https://example.test/schema.json",
		Purposes:   []domain.FlowDefinitionPurposeEntry{{Purpose: domain.FlowDefinitionPurposeLogin, InitialStep: "start"}},
	}
	wantState := &domain.FlowState{}
	sm := &fakeStateMachine{startOut: domain.FlowStepResult{State: wantState, Step: &domain.FlowStep{Name: "start"}}}
	ids := &scriptedIDGen{ids: []string{"01FLOW", "01SESS"}}

	svc := service.NewFlowService(stubPool(), nil, sm, ids)
	redirect := "https://app.example/cb"
	result, err := svc.Start(t.Context(), service.StartFlowRequest{
		Definition:  def,
		Purpose:     domain.FlowDefinitionPurposeLogin,
		RedirectURI: &redirect,
	})
	if err != nil {
		t.Fatalf("Start error: %v", err)
	}
	if result.State.ID != "flow_01FLOW" {
		t.Errorf("State.ID = %q, want flow_01FLOW", result.State.ID)
	}
	if sm.startIn.UserSchemaURL != def.UserSchema {
		t.Errorf("UserSchemaURL = %q, want %q", sm.startIn.UserSchemaURL, def.UserSchema)
	}
	if sm.startIn.Session.ID != "sess_01SESS" {
		t.Errorf("Session.ID = %q, want sess_01SESS", sm.startIn.Session.ID)
	}
	if sm.startIn.RedirectURI == nil || *sm.startIn.RedirectURI != redirect {
		t.Errorf("RedirectURI = %v, want %q", sm.startIn.RedirectURI, redirect)
	}
}

func TestStart_PropagatesIDGenError(t *testing.T) {
	sentinel := errors.New("idgen boom")
	svc := service.NewFlowService(stubPool(), nil, &fakeStateMachine{}, &scriptedIDGen{err: sentinel})
	_, err := svc.Start(t.Context(), service.StartFlowRequest{
		Definition: &domain.FlowDefinition{ProjectID: "proj", ID: "def-1"},
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("Start err = %v, want sentinel", err)
	}
}

func TestSubmit_RefetchesDefinitionByDefinitionID(t *testing.T) {
	state := &domain.FlowState{
		ProjectID:    "proj",
		FlowProgress: domain.FlowProgress{DefinitionID: "def-1", CurrentStep: "credentials"},
	}
	def := &domain.FlowDefinition{ProjectID: "proj", ID: "def-1"}

	ctrl := gomock.NewController(t)
	repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
	repo.EXPECT().
		GetFlowDefinition(gomock.Any(), gomock.Any(), "proj", "def-1").
		Return(def, nil)

	sm := &fakeStateMachine{submitOut: domain.FlowStepResult{State: state, Step: &domain.FlowStep{Name: "next"}}}
	svc := service.NewFlowService(stubPool(), repo, sm, &scriptedIDGen{})

	sso := "google"
	_, err := svc.Submit(t.Context(), service.SubmitFlowRequest{
		State:         state,
		Action:        "submit",
		Fields:        map[string]any{"email": "a@b"},
		SSOProviderID: &sso,
	})
	if err != nil {
		t.Fatalf("Submit error: %v", err)
	}
	if sm.submitDef != def {
		t.Errorf("Process received def %v, want %v", sm.submitDef, def)
	}
	if sm.submitIn.Action != "submit" || sm.submitIn.Fields["email"] != "a@b" {
		t.Errorf("Process submit input = %+v", sm.submitIn)
	}
	if sm.submitIn.SSOProvider == nil || sm.submitIn.SSOProvider.ID != sso {
		t.Errorf("SSOProvider = %+v, want id=%q", sm.submitIn.SSOProvider, sso)
	}
}

func TestSubmit_RepoErrorPropagates(t *testing.T) {
	sentinel := errors.New("repo boom")
	state := &domain.FlowState{ProjectID: "proj", FlowProgress: domain.FlowProgress{DefinitionID: "def-1"}}
	ctrl := gomock.NewController(t)
	repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
	repo.EXPECT().
		GetFlowDefinition(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
		Return(nil, sentinel)

	svc := service.NewFlowService(stubPool(), repo, &fakeStateMachine{}, &scriptedIDGen{})
	_, err := svc.Submit(t.Context(), service.SubmitFlowRequest{State: state, Action: "submit"})
	if !errors.Is(err, sentinel) {
		t.Fatalf("Submit err = %v, want sentinel", err)
	}
}

func TestGetStep_RendersWithoutAdvancing(t *testing.T) {
	state := &domain.FlowState{ProjectID: "proj", FlowProgress: domain.FlowProgress{DefinitionID: "def-1", CurrentStep: "credentials"}}
	def := &domain.FlowDefinition{ProjectID: "proj", ID: "def-1"}

	ctrl := gomock.NewController(t)
	repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
	repo.EXPECT().
		GetFlowDefinition(gomock.Any(), gomock.Any(), "proj", "def-1").
		Return(def, nil)

	sm := &fakeStateMachine{renderOut: domain.FlowStepResult{State: state, Step: &domain.FlowStep{Name: "credentials"}}}
	svc := service.NewFlowService(stubPool(), repo, sm, &scriptedIDGen{})

	result, err := svc.GetStep(t.Context(), service.GetFlowStepRequest{State: state})
	if err != nil {
		t.Fatalf("GetStep error: %v", err)
	}
	if sm.renderDef != def {
		t.Errorf("Render received def %v, want %v", sm.renderDef, def)
	}
	if sm.renderState != state {
		t.Errorf("Render received state %v, want %v", sm.renderState, state)
	}
	if result.Step.Name != "credentials" {
		t.Errorf("result.Step.Name = %q, want credentials", result.Step.Name)
	}
}
