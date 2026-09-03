package service_test

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func stubDB(t *testing.T) *service.DB {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	ids := &stubIDGen{}
	stmts.EXPECT().NewManagedID(gomock.Any()).DoAndReturn(func(prefix string) (string, error) {
		return ids.New(prefix)
	}).AnyTimes()
	stmts.EXPECT().CreateSession(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, sess *domain.Session) error {
		if sess.ID == "" {
			sess.ID = "sess_1" // storage assigns the id; simulate it here
		}
		return nil
	}).AnyTimes()
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	return service.NewPool(pool)
}

// stubListFlowDefinitions wires ListFlowDefinitions to filter the given slice
// in-memory the same way the storage layer does. Optional times defaults to 1.
func stubListFlowDefinitions(t *testing.T, defs []*domain.FlowDefinition, times ...int) *service.DB {
	t.Helper()
	n := 1
	if len(times) > 0 {
		n = times[0]
	}
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	stmts.EXPECT().ListFlowDefinitions(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, opts *database.ListOptions[domain.FlowDefinitionField]) (*database.ListResult[*domain.FlowDefinition], error) {
			out := make([]*domain.FlowDefinition, 0, len(defs))
			for _, def := range defs {
				if !matchesFlowDefinitionFilter(def, opts) {
					continue
				}
				out = append(out, def)
			}
			return &database.ListResult[*domain.FlowDefinition]{Items: out}, nil
		},
	).Times(n)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	return service.NewPool(pool)
}

func matchesFlowDefinitionFilter(def *domain.FlowDefinition, opts *database.ListOptions[domain.FlowDefinitionField]) bool {
	if opts == nil || opts.Filter == nil {
		return true
	}
	return filterMatches(def, opts.Filter)
}

func filterMatches(def *domain.FlowDefinition, filter database.Filter[domain.FlowDefinitionField]) bool {
	switch f := filter.(type) {
	case database.AndFilter[domain.FlowDefinitionField]:
		for _, child := range f.Filters {
			if !filterMatches(def, child) {
				return false
			}
		}
		return true
	case *database.CompareFilter[domain.FlowDefinitionField]:
		if f.Op != database.OpEqual || len(f.Terms) != 1 {
			return true
		}
		term := f.Terms[0]
		switch term.Column.Field() {
		case domain.FlowDefinitionFieldProjectID:
			return def.ProjectID == term.Value.(string)
		case domain.FlowDefinitionFieldID:
			return def.ID == term.Value.(string)
		case domain.FlowDefinitionFieldName:
			return def.Name == term.Value.(string)
		case domain.FlowDefinitionFieldSchemaVersion:
			return def.SchemaVersion == term.Value.(string)
		case domain.FlowDefinitionFieldStatus:
			return def.Status.String() == term.Value.(string)
		default:
			return true
		}
	case *database.ArrayContainsFilter[domain.FlowDefinitionField]:
		if f.Column.Field() != domain.FlowDefinitionFieldPurposes {
			return true
		}
		s, ok := f.Value.(string)
		if !ok {
			return false
		}
		purpose, err := domain.FlowDefinitionPurposeString(s)
		if err != nil {
			return false
		}
		return hasPurpose(def, purpose)
	default:
		return true
	}
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

	got, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
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
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	stmts.EXPECT().ListFlowDefinitions(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, opts *database.ListOptions[domain.FlowDefinitionField]) (*database.ListResult[*domain.FlowDefinition], error) {
			if opts == nil || opts.Filter == nil {
				t.Fatal("expected filter")
			}
			if !filterMatches(def, opts.Filter) {
				t.Errorf("filter did not match expected definition attributes")
			}
			// assert required fields are restricted
			if !opts.Filter.Restricts(database.Col(domain.FlowDefinitionFieldName)) {
				t.Error("expected Name filter")
			}
			if !opts.Filter.Restricts(database.Col(domain.FlowDefinitionFieldStatus)) {
				t.Error("expected Status filter")
			}
			if !opts.Filter.Restricts(database.Col(domain.FlowDefinitionFieldSchemaVersion)) {
				t.Error("expected SchemaVersion filter")
			}
			return &database.ListResult[*domain.FlowDefinition]{Items: []*domain.FlowDefinition{def}}, nil
		},
	)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	repo := service.NewPool(pool)

	_, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
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

	got, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
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

// Revisions of one name share a schema version, so the pick must not
// depend on the order storage returns them in.
func TestResolve_ResolveByName_SameVersionPicksNewest(t *testing.T) {
	older := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	older.ID = "flowdef_older"
	older.CreatedAt = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	newer := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	newer.ID = "flowdef_newer"
	newer.CreatedAt = time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)

	for _, defs := range [][]*domain.FlowDefinition{{older, newer}, {newer, older}} {
		repo := stubListFlowDefinitions(t, defs)
		got, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
			ProjectID: "proj",
			Purpose:   domain.FlowDefinitionPurposeLogin,
			Name:      ptr("login"),
		})
		if err != nil {
			t.Fatalf("Resolve returned error: %v", err)
		}
		if got != newer {
			t.Fatalf("Resolve = %v, want the newest revision", got.ID)
		}
	}
}

// Colliding created_at timestamps within one name still yield a stable
// pick: the higher id wins.
func TestResolve_ResolveByName_TimestampCollisionBreaksOnID(t *testing.T) {
	at := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	a := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	a.ID = "flowdef_aaa"
	a.CreatedAt = at
	b := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	b.ID = "flowdef_bbb"
	b.CreatedAt = at

	for _, defs := range [][]*domain.FlowDefinition{{a, b}, {b, a}} {
		repo := stubListFlowDefinitions(t, defs)
		got, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
			ProjectID: "proj",
			Purpose:   domain.FlowDefinitionPurposeLogin,
			Name:      ptr("login"),
		})
		if err != nil {
			t.Fatalf("Resolve returned error: %v", err)
		}
		if got != b {
			t.Fatalf("Resolve = %v, want the revision with the higher id", got.ID)
		}
	}
}

func TestResolve_ResolveByName_NotFound(t *testing.T) {
	repo := stubListFlowDefinitions(t, nil)

	_, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
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

	_, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
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

	got, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
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

	_, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
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

	got, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
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
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	stmts.EXPECT().ListFlowDefinitions(gomock.Any(), gomock.Any()).Return(nil, sentinel)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	repo := service.NewPool(pool)

	_, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
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

	got, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
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

	got, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
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

	got, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
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

	got, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
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
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{human, machine}, 2)

	svc := service.NewFlowService(repo, nil)
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
		got, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
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
		got, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
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

	gotStartCtx    context.Context
	gotStartInput  domain.FlowStartInput
	gotSubmitInput domain.FlowSubmitInput
	gotProcessDef  *domain.FlowDefinition
	gotRenderState *domain.FlowState
}

func (f *fakeStateMachine) Start(ctx context.Context, in domain.FlowStartInput) (domain.FlowStepResult, error) {
	f.gotStartCtx = ctx
	f.gotStartInput = in
	return f.startResult, f.startErr
}

func (f *fakeStateMachine) Process(_ context.Context, def *domain.FlowDefinition, _ *domain.FlowState, in domain.FlowSubmitInput) (domain.FlowStepResult, error) {
	f.gotProcessDef = def
	f.gotSubmitInput = in
	return f.processResult, f.processErr
}

func (f *fakeStateMachine) Render(_ context.Context, _ *domain.FlowDefinition, state *domain.FlowState) (domain.FlowStepResult, error) {
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

// stubGetFlowDefinition returns def for any GetFlowDefinitionByID call.
func stubGetFlowDefinition(t *testing.T, def *domain.FlowDefinition) *service.DB {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	stmts.EXPECT().GetFlowDefinitionByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, projectID, id string) (*domain.FlowDefinition, error) {
			if def == nil || def.ProjectID != projectID || def.ID != id {
				return nil, database.NewNoRowFoundError(nil)
			}
			return def, nil
		},
	).Times(1)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	return service.NewPool(pool)
}

func TestFlowService_Start_MintsFlowAndSessionIDs(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	def.UserSchema = "https://example.com/user.json"

	state := &domain.FlowState{ProjectID: def.ProjectID}
	sm := &fakeStateMachine{startResult: domain.FlowStepResult{State: state, Step: &domain.FlowStep{Name: "start"}}}

	svc := service.NewFlowService(stubDB(t), sm)

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

// Path B auth.attempt.created runs inside stateMachine.Start. The flow id
// must already be on the actor slot so FromContext can copy flow_id.
func TestFlowService_Start_StampsFlowIDBeforeStateMachine(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	state := &domain.FlowState{ProjectID: def.ProjectID}
	sm := &fakeStateMachine{startResult: domain.FlowStepResult{State: state, Step: &domain.FlowStep{Name: "start"}}}
	svc := service.NewFlowService(stubDB(t), sm)

	ctx := audit.WithActorSlot(t.Context())
	res, err := svc.Start(ctx, service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeLogin,
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}

	slot, ok := audit.ActorSlotFromContext(sm.gotStartCtx)
	if !ok || slot == nil {
		t.Fatal("state machine Start ctx has no actor slot")
	}
	if slot.FlowID == nil || *slot.FlowID == "" {
		t.Fatal("flow_id was not stamped before stateMachine.Start (auth.attempt.created would miss it)")
	}
	if res.State == nil || *slot.FlowID != res.State.ID {
		t.Errorf("stamped flow_id = %v, want %q", slot.FlowID, res.State.ID)
	}
	if slot.SessionID == nil || *slot.SessionID == "" {
		t.Fatal("session_id was not stamped before stateMachine.Start")
	}
	if sm.gotStartInput.Session.ID != *slot.SessionID {
		t.Errorf("stamped session_id = %q, want %q", *slot.SessionID, sm.gotStartInput.Session.ID)
	}
}

func TestFlowService_Start_PassesRedirectURIThrough(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	state := &domain.FlowState{ProjectID: def.ProjectID}
	sm := &fakeStateMachine{startResult: domain.FlowStepResult{State: state, Step: &domain.FlowStep{}}}

	svc := service.NewFlowService(stubDB(t), sm)

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

	// No CreateSession is wired: supplying a session must reuse it, so any call
	// to CreateSession fails the test (proving no new session is created and the
	// existing session's user agent is left untouched).
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	stmts.EXPECT().NewManagedID(gomock.Any()).Return("flow_1", nil).AnyTimes()
	pool.EXPECT().Statements().Return(stmts).AnyTimes()

	svc := service.NewFlowService(service.NewPool(pool), sm)

	sessionID := "sess_explicit"
	if _, err := svc.Start(t.Context(), service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeReauth,
		SessionID:  &sessionID,
		UserAgent:  &domain.UserAgent{IP: "203.0.113.9"}, // must not trigger a create
	}); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if sm.gotStartInput.Session.ID != sessionID {
		t.Errorf("Session.ID = %q, want %q", sm.gotStartInput.Session.ID, sessionID)
	}
}

func TestFlowService_Start_PersistsSession(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	state := &domain.FlowState{ProjectID: def.ProjectID}
	sm := &fakeStateMachine{startResult: domain.FlowStepResult{State: state, Step: &domain.FlowStep{}}}

	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	stmts.EXPECT().NewManagedID(gomock.Any()).Return("flow_1", nil).AnyTimes()
	stmts.EXPECT().CreateSession(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, sess *domain.Session) error {
		// With no supplied session, Start persists one for the flow's project.
		// The anonymous/building nature of a new session is domain.NewSession's
		// contract, covered by the domain and stmttest suites.
		if sess.ProjectID != def.ProjectID {
			t.Errorf("session ProjectID = %q, want %q", sess.ProjectID, def.ProjectID)
		}
		sess.ID = "sess_created"
		return nil
	}).Times(1)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()

	svc := service.NewFlowService(service.NewPool(pool), sm)

	if _, err := svc.Start(t.Context(), service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeLogin,
	}); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if sm.gotStartInput.Session.ID != "sess_created" {
		t.Errorf("Session.ID = %q, want the persisted session id", sm.gotStartInput.Session.ID)
	}
}

func TestFlowService_Start_RecordsUserAgent(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	state := &domain.FlowState{ProjectID: def.ProjectID}
	sm := &fakeStateMachine{startResult: domain.FlowStepResult{State: state, Step: &domain.FlowStep{}}}

	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	stmts.EXPECT().NewManagedID(gomock.Any()).Return("flow_1", nil).AnyTimes()
	stmts.EXPECT().CreateSession(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, sess *domain.Session) error {
		// The request's user agent is recorded on the session the flow creates.
		if sess.UserAgent == nil || sess.UserAgent.IP != "203.0.113.9" {
			t.Errorf("session user agent = %+v, want IP 203.0.113.9", sess.UserAgent)
		}
		sess.ID = "sess_created"
		return nil
	}).Times(1)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()

	svc := service.NewFlowService(service.NewPool(pool), sm)

	if _, err := svc.Start(t.Context(), service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeLogin,
		UserAgent:  &domain.UserAgent{IP: "203.0.113.9", Info: map[string]any{"user_agent": "agent/1"}},
	}); err != nil {
		t.Fatalf("Start: %v", err)
	}
}

func TestFlowService_Start_RejectsEmptySessionID(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	sm := &fakeStateMachine{}

	svc := service.NewFlowService(stubDB(t), sm)

	empty := ""
	_, err := svc.Start(t.Context(), service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeLogin,
		SessionID:  &empty,
	})
	if !errors.Is(err, domain.ErrRequestInvalid()) {
		t.Fatalf("Start err = %v, want ErrRequestInvalid", err)
	}
}

func TestFlowService_Start_PropagatesStateMachineError(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	sm := &fakeStateMachine{startErr: errors.New("boom")}

	svc := service.NewFlowService(stubDB(t), sm)

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

	svc := service.NewFlowService(repo, sm)

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

	svc := service.NewFlowService(repo, sm)

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

	svc := service.NewFlowService(repo, sm)

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
