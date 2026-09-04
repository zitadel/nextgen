package service_test

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
		Name:          new("login"),
		SchemaVersion: new("1.2.3"),
	})
	require.NoError(t, err)
	assert.Same(t, want, got)
}

func TestResolve_ResolveByName_FiltersWithRequestedOptions(t *testing.T) {
	def := newDef("login", "1.2.3", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)

	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	stmts.EXPECT().ListFlowDefinitions(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, opts *database.ListOptions[domain.FlowDefinitionField]) (*database.ListResult[*domain.FlowDefinition], error) {
			require.NotNil(t, opts)
			require.NotNil(t, opts.Filter, "expected filter")
			assert.True(t, filterMatches(def, opts.Filter), "filter did not match expected definition attributes")
			// assert required fields are restricted
			assert.True(t, opts.Filter.Restricts(database.Col(domain.FlowDefinitionFieldName)), "expected Name filter")
			assert.True(t, opts.Filter.Restricts(database.Col(domain.FlowDefinitionFieldStatus)), "expected Status filter")
			assert.True(t, opts.Filter.Restricts(database.Col(domain.FlowDefinitionFieldSchemaVersion)), "expected SchemaVersion filter")
			return &database.ListResult[*domain.FlowDefinition]{Items: []*domain.FlowDefinition{def}}, nil
		},
	)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	repo := service.NewPool(pool)

	_, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID:     "proj",
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Name:          new("login"),
		SchemaVersion: new("1.2.3"),
	})
	require.NoError(t, err)
}

func TestResolve_ResolveByName_LatestActiveWhenVersionNil(t *testing.T) {
	v1 := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	v2 := newDef("login", "2.4.1", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	v15 := newDef("login", "1.5.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{v1, v2, v15})

	got, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Name:      new("login"),
	})
	require.NoError(t, err)
	assert.Same(t, v2, got, "want the latest version")
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
			Name:      new("login"),
		})
		require.NoError(t, err)
		assert.Same(t, newer, got, "want the newest revision")
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
			Name:      new("login"),
		})
		require.NoError(t, err)
		assert.Same(t, b, got, "want the revision with the higher id")
	}
}

func TestResolve_ResolveByName_NotFound(t *testing.T) {
	repo := stubListFlowDefinitions(t, nil)

	_, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Name:      new("missing"),
	})
	assert.ErrorIs(t, err, domain.ErrFlowDefinitionNotFound())
}

func TestResolve_ResolveByName_PurposeMismatch(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{def})

	_, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeRegister,
		Name:      new("login"),
	})
	assert.ErrorIs(t, err, domain.ErrFlowDefinitionPurposeMismatch())
}

func TestResolve_ResolveByAudience_ReturnsFirstMatchingPurpose(t *testing.T) {
	first := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	second := newDef("alt", "1.0.0", domain.FlowDefinitionAudience{AppIDs: []string{"app-1"}}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{first, second})

	got, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
	})
	require.NoError(t, err)
	assert.Same(t, first, got, "want first definition")
}

func TestResolve_ResolveByAudience_NoMatch(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{def})

	_, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeRegister,
	})
	assert.ErrorIs(t, err, domain.ErrFlowDefinitionNotFound())
}

func TestResolve_ResolveByAudience_ExactVersionFiltersOlder(t *testing.T) {
	v1 := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	v2 := newDef("login", "2.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{v1, v2})

	got, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID:     "proj",
		Purpose:       domain.FlowDefinitionPurposeLogin,
		SchemaVersion: new("1.0.0"),
	})
	require.NoError(t, err)
	assert.Same(t, v1, got, "want v1 (exact match)")
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
	assert.ErrorIs(t, err, sentinel)
}

func TestResolve_ResolveByAudience_AppHintOutranksTeamAndDefault(t *testing.T) {
	byApp := newDef("by-app", "1.0.0", domain.FlowDefinitionAudience{AppIDs: []string{"app-1"}}, domain.FlowDefinitionPurposeLogin)
	byTeam := newDef("by-team", "1.0.0", domain.FlowDefinitionAudience{TeamIDs: []string{"team-1"}}, domain.FlowDefinitionPurposeLogin)
	fallback := newDef("default", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{fallback, byTeam, byApp})

	got, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Hint:      service.ResolveFlowHint{AppID: new("app-1"), TeamID: new("team-1")},
	})
	require.NoError(t, err)
	assert.Same(t, byApp, got, "want the app-scoped definition")
}

func TestResolve_ResolveByAudience_TeamHintOutranksDefault(t *testing.T) {
	byTeam := newDef("by-team", "1.0.0", domain.FlowDefinitionAudience{TeamIDs: []string{"team-1"}}, domain.FlowDefinitionPurposeLogin)
	fallback := newDef("default", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{fallback, byTeam})

	got, err := service.NewFlowService(repo, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Hint:      service.ResolveFlowHint{TeamID: new("team-1")},
	})
	require.NoError(t, err)
	assert.Same(t, byTeam, got, "want the team-scoped definition")
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
	require.NoError(t, err)
	assert.Same(t, fallback, got, "want the unscoped default")
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
		Hint:      service.ResolveFlowHint{AppID: new("app-2")},
	})
	require.NoError(t, err)
	assert.Same(t, scoped, got, "want the only remaining definition")
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
		Hint:      service.ResolveFlowHint{UserSchemaID: new("https://tenant.com/schemas/machine.json")},
	})
	require.NoError(t, err)
	assert.Same(t, machine, got, "want the machine-schema definition despite being older")

	_, err = svc.Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Hint:      service.ResolveFlowHint{UserSchemaID: new("https://tenant.com/schemas/unknown.json")},
	})
	assert.ErrorIs(t, err, domain.ErrFlowDefinitionNotFound(), "unmatched schema hint")
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
		require.NoError(t, err)
		assert.Same(t, newer, got, "want the newest definition")
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
		require.NoError(t, err)
		assert.Same(t, b, got, "want the definition with the higher id")
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
	require.NoError(t, err)
	require.NotNil(t, res.State)
	assert.NotEmpty(t, res.State.ID, "flow id was not minted")
	assert.NotEmpty(t, sm.gotStartInput.Session.ID, "session id was not minted")
	assert.Equal(t, def.UserSchema, sm.gotStartInput.UserSchemaURL)
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
	require.NoError(t, err)

	slot, ok := audit.ActorSlotFromContext(sm.gotStartCtx)
	require.True(t, ok, "state machine Start ctx has no actor slot")
	require.NotNil(t, slot)
	require.NotEmpty(t, slot.FlowID, "flow_id was not stamped before stateMachine.Start (auth.attempt.created would miss it)")
	require.NotNil(t, res.State)
	assert.Equal(t, res.State.ID, *slot.FlowID, "stamped flow_id")
	require.NotEmpty(t, slot.SessionID, "session_id was not stamped before stateMachine.Start")
	assert.Equal(t, *slot.SessionID, sm.gotStartInput.Session.ID, "stamped session_id")
}

func TestFlowService_Start_PassesRedirectURIThrough(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	state := &domain.FlowState{ProjectID: def.ProjectID}
	sm := &fakeStateMachine{startResult: domain.FlowStepResult{State: state, Step: &domain.FlowStep{}}}

	svc := service.NewFlowService(stubDB(t), sm)

	redirect := "https://rp.example.com/cb"
	_, err := svc.Start(t.Context(), service.StartFlowRequest{
		Definition:  def,
		Purpose:     domain.FlowDefinitionPurposeLogin,
		RedirectURI: &redirect,
	})
	require.NoError(t, err)
	assert.Equal(t, &redirect, sm.gotStartInput.RedirectURI)
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
	_, err := svc.Start(t.Context(), service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeReauth,
		SessionID:  &sessionID,
		UserAgent:  &domain.UserAgent{IP: "203.0.113.9"}, // must not trigger a create
	})
	require.NoError(t, err)
	assert.Equal(t, sessionID, sm.gotStartInput.Session.ID)
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
		assert.Equal(t, def.ProjectID, sess.ProjectID)
		sess.ID = "sess_created"
		return nil
	}).Times(1)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()

	svc := service.NewFlowService(service.NewPool(pool), sm)

	_, err := svc.Start(t.Context(), service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeLogin,
	})
	require.NoError(t, err)
	assert.Equal(t, "sess_created", sm.gotStartInput.Session.ID, "want the persisted session id")
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
		require.NotNil(t, sess.UserAgent)
		assert.Equal(t, "203.0.113.9", sess.UserAgent.IP)
		sess.ID = "sess_created"
		return nil
	}).Times(1)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()

	svc := service.NewFlowService(service.NewPool(pool), sm)

	_, err := svc.Start(t.Context(), service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeLogin,
		UserAgent:  &domain.UserAgent{IP: "203.0.113.9", Info: map[string]any{"user_agent": "agent/1"}},
	})
	require.NoError(t, err)
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
	assert.ErrorIs(t, err, domain.ErrRequestInvalid())
}

func TestFlowService_Start_PropagatesStateMachineError(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	sm := &fakeStateMachine{startErr: errors.New("boom")}

	svc := service.NewFlowService(stubDB(t), sm)

	_, err := svc.Start(t.Context(), service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeLogin,
	})
	assert.EqualError(t, err, "boom")
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
	_, err := svc.Submit(t.Context(), service.SubmitFlowRequest{
		State:  state,
		Action: "submit",
	})
	require.NoError(t, err)
	require.NotNil(t, sm.gotProcessDef, "Process was not called with refetched definition")
	assert.Equal(t, def.ID, sm.gotProcessDef.ID, "Process was not called with refetched definition")
	assert.Equal(t, "submit", sm.gotSubmitInput.Action)
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
	require.NoError(t, err)
	assert.Equal(t, "ht_abc", res.HandoffToken)
	assert.True(t, res.HandoffTokenExpiresAt.Equal(expiresAt), "HandoffTokenExpiresAt = %v, want %v", res.HandoffTokenExpiresAt, expiresAt)
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
	require.NoError(t, err)
	assert.Same(t, state, sm.gotRenderState, "Render was called with the wrong state")
	require.NotNil(t, res.Step)
	assert.Equal(t, "identify", res.Step.Name)
}
