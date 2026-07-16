package service_test

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

// stubPool returns nil typed as database.Pool. The mock repository does not
// invoke any methods on it, so the value is opaque — it only satisfies the
// service constructor signature.
func stubPool() database.Pool { return nil }

func stubV2Pool() *service.DB { return nil }

type testAllStatements struct {
	createProject  func(context.Context, *domain.Project) error
	getProjectByID func(context.Context, string) (*domain.Project, error)
}

func (testAllStatements) IsStatements() {}

func (s testAllStatements) CreateProject(ctx context.Context, project *domain.Project) error {
	if s.createProject != nil {
		return s.createProject(ctx, project)
	}
	return nil
}

func (s testAllStatements) GetProjectByID(ctx context.Context, id string) (*domain.Project, error) {
	if s.getProjectByID != nil {
		return s.getProjectByID(ctx, id)
	}
	return nil, nil
}

func (testAllStatements) UpdateProject(context.Context, *domain.Project) error {
	panic("unexpected call to UpdateProject")
}

func (testAllStatements) ListProjects(context.Context, *v2database.ListOptions[domain.ProjectField]) (*v2database.ListResult[*domain.Project], error) {
	panic("unexpected call to ListProjects")
}

func (testAllStatements) DeleteProjectByID(context.Context, string) error {
	panic("unexpected call to DeleteProjectByID")
}

func (testAllStatements) CreateFlowDefinition(context.Context, *domain.FlowDefinition) error {
	panic("unexpected call to CreateFlowDefinition")
}

func (testAllStatements) GetFlowDefinitionByID(context.Context, string) (*domain.FlowDefinition, error) {
	panic("unexpected call to GetFlowDefinitionByID")
}

func (testAllStatements) ListFlowDefinitions(context.Context, *v2database.ListOptions[domain.FlowDefinitionField]) (*v2database.ListResult[*domain.FlowDefinition], error) {
	panic("unexpected call to ListFlowDefinitions")
}

func (testAllStatements) DeleteFlowDefinitionByID(context.Context, string) error {
	panic("unexpected call to DeleteFlowDefinitionByID")
}

var _ service.AllStatements = testAllStatements{}

type v2TestTx struct {
	database.QueryExecutor
	stmts service.AllStatements
}

func (t v2TestTx) Statements() service.AllStatements {
	return t.stmts
}

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
	_, ok := def.Purposes[purpose]
	return ok
}

func ptr[T any](v T) *T { return &v }

func newDef(name, version string, audience domain.FlowDefinitionAudience, purposes ...domain.FlowDefinitionPurpose) *domain.FlowDefinition {
	entries := make(map[domain.FlowDefinitionPurpose]string, len(purposes))
	for _, p := range purposes {
		entries[p] = "start"
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

func TestResolve_ResolveByAudience_AppHintOutranksTeamAndDefault(t *testing.T) {
	byApp := newDef("by-app", "1.0.0", domain.FlowDefinitionAudience{AppIDs: []string{"app-1"}}, domain.FlowDefinitionPurposeLogin)
	byTeam := newDef("by-team", "1.0.0", domain.FlowDefinitionAudience{TeamIDs: []string{"team-1"}}, domain.FlowDefinitionPurposeLogin)
	fallback := newDef("default", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{fallback, byTeam, byApp})

	got, err := service.NewFlowService(stubPool(), repo, nil, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Hint:      service.ResolveFlowHint{AppID: ptr("app-1"), TeamID: ptr("team-1")},
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got != byApp {
		t.Fatalf("Resolve = %v, want the app-scoped definition", got.Name)
	}
}

func TestResolve_ResolveByAudience_TeamHintOutranksDefault(t *testing.T) {
	byTeam := newDef("by-team", "1.0.0", domain.FlowDefinitionAudience{TeamIDs: []string{"team-1"}}, domain.FlowDefinitionPurposeLogin)
	fallback := newDef("default", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{fallback, byTeam})

	got, err := service.NewFlowService(stubPool(), repo, nil, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Hint:      service.ResolveFlowHint{TeamID: ptr("team-1")},
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got != byTeam {
		t.Fatalf("Resolve = %v, want the team-scoped definition", got.Name)
	}
}

// A definition scoped to an app must not capture unhinted requests just by
// being newer — the unscoped project default outranks it.
func TestResolve_ResolveByAudience_ScopedFlowDoesNotCaptureDefault(t *testing.T) {
	fallback := newDef("default", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	fallback.CreatedAt = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	scoped := newDef("kiosk", "1.0.0", domain.FlowDefinitionAudience{AppIDs: []string{"app-1"}}, domain.FlowDefinitionPurposeLogin)
	scoped.CreatedAt = time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{scoped, fallback})

	got, err := service.NewFlowService(stubPool(), repo, nil, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got != fallback {
		t.Fatalf("Resolve = %v, want the unscoped default", got.Name)
	}
}

// Hints are routing suggestions, not a security boundary: when only scoped
// definitions exist and none matches the hint, resolution still succeeds
// rather than failing the login.
func TestResolve_ResolveByAudience_UnmatchedHintFallsBackToScoped(t *testing.T) {
	scoped := newDef("kiosk", "1.0.0", domain.FlowDefinitionAudience{AppIDs: []string{"app-1"}}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{scoped})

	got, err := service.NewFlowService(stubPool(), repo, nil, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Hint:      service.ResolveFlowHint{AppID: ptr("app-2")},
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got != scoped {
		t.Fatalf("Resolve = %v, want the only remaining definition", got.Name)
	}
}

func TestResolve_ResolveByAudience_UserSchemaHintFilters(t *testing.T) {
	human := newDef("human", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	human.UserSchema = "https://tenant.com/schemas/human.json"
	human.CreatedAt = time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	machine := newDef("machine", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	machine.UserSchema = "https://tenant.com/schemas/machine.json"
	machine.CreatedAt = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{human, machine})

	svc := service.NewFlowService(stubPool(), repo, nil, nil)
	got, err := svc.Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Hint:      service.ResolveFlowHint{UserSchemaID: ptr("https://tenant.com/schemas/machine.json")},
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got != machine {
		t.Fatalf("Resolve = %v, want the machine-schema definition despite being older", got.Name)
	}

	_, err = svc.Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Hint:      service.ResolveFlowHint{UserSchemaID: ptr("https://tenant.com/schemas/unknown.json")},
	})
	if !errors.Is(err, domain.ErrFlowDefinitionNotFound()) {
		t.Fatalf("Resolve err = %v, want ErrFlowDefinitionNotFound for unmatched schema hint", err)
	}
}

func TestResolve_ResolveByAudience_NoHintPicksNewestDeterministically(t *testing.T) {
	older := newDef("older", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	older.CreatedAt = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	newer := newDef("newer", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	newer.CreatedAt = time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)

	// Both list orders yield the same pick — the newest definition.
	for _, defs := range [][]*domain.FlowDefinition{{older, newer}, {newer, older}} {
		repo := stubListFlowDefinitions(t, defs)
		got, err := service.NewFlowService(stubPool(), repo, nil, nil).Resolve(t.Context(), service.ResolveFlowRequest{
			ProjectID: "proj",
			Purpose:   domain.FlowDefinitionPurposeLogin,
		})
		if err != nil {
			t.Fatalf("Resolve returned error: %v", err)
		}
		if got != newer {
			t.Fatalf("Resolve = %v, want the newest definition", got.Name)
		}
	}
}

// Colliding created_at timestamps (one bulk apply writing several flows)
// still yield a stable pick: the higher id wins.
func TestResolve_ResolveByAudience_TimestampCollisionBreaksOnID(t *testing.T) {
	at := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	a := newDef("aaa", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	a.CreatedAt = at
	b := newDef("bbb", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	b.CreatedAt = at

	for _, defs := range [][]*domain.FlowDefinition{{a, b}, {b, a}} {
		repo := stubListFlowDefinitions(t, defs)
		got, err := service.NewFlowService(stubPool(), repo, nil, nil).Resolve(t.Context(), service.ResolveFlowRequest{
			ProjectID: "proj",
			Purpose:   domain.FlowDefinitionPurposeLogin,
		})
		if err != nil {
			t.Fatalf("Resolve returned error: %v", err)
		}
		if got != b {
			t.Fatalf("Resolve = %v, want the definition with the higher id", got.Name)
		}
	}
}

// fakeStateMachine captures inputs and returns pre-loaded results.
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

// stubIDGen returns deterministic prefix_N ids.
type stubIDGen struct {
	calls int
}

func (s *stubIDGen) New(prefix string) (string, error) {
	s.calls++
	return prefix + "_" + strconv.Itoa(s.calls), nil
}

// stubGetFlowDefinition returns def for any GetFlowDefinition call.
func stubGetFlowDefinition(t *testing.T, def *domain.FlowDefinition) *domainmock.MockFlowDefinitionRepository {
	t.Helper()
	ctrl := gomock.NewController(t)
	repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
	repo.EXPECT().
		GetFlowDefinition(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
		Return(def, nil).
		AnyTimes()
	return repo
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

func TestFlowService_Submit_PropagatesHandoffToken(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubGetFlowDefinition(t, def)
	expiresAt := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	sm := &fakeStateMachine{processResult: domain.FlowStepResult{
		State:                 &domain.FlowState{ID: "flow_1"},
		Step:                  &domain.FlowStep{Name: "done"},
		HandoffToken:          "ht_abc",
		HandoffTokenExpiresAt: expiresAt,
	}}

	svc := service.NewFlowService(stubPool(), repo, sm, &stubIDGen{})

	res, err := svc.Submit(t.Context(), service.SubmitFlowRequest{
		State: &domain.FlowState{
			ID:           "flow_1",
			ProjectID:    def.ProjectID,
			FlowProgress: domain.FlowProgress{DefinitionID: def.ID},
		},
		Action: "submit",
	})
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	if res.HandoffToken != "ht_abc" {
		t.Errorf("HandoffToken = %q, want ht_abc", res.HandoffToken)
	}
	if !res.HandoffTokenExpiresAt.Equal(expiresAt) {
		t.Errorf("HandoffTokenExpiresAt = %v, want %v", res.HandoffTokenExpiresAt, expiresAt)
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
