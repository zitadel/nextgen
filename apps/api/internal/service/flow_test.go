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

	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/crypto/pow"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/flowengine"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func stubDB(t *testing.T) *service.DB {
	t.Helper()
	return stubDBWithSchemas(t, testUserSchema)
}

// stubDBWithSchemas is stubDB serving schemas as the project's user schemas.
func stubDBWithSchemas(t *testing.T, schemas ...*domain.JSONSchema) *service.DB {
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
	stubUserSchemas(stmts, schemas...)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	return service.NewPool(pool)
}

// testUserSchema is the schema newDef's definitions name.
var testUserSchema = &domain.JSONSchema{
	ProjectID:  "proj",
	URL:        "https://example.com/user.json",
	ObjectType: new("human-user"),
}

// testMachineSchema is a second user schema, for definitions that name another.
var testMachineSchema = &domain.JSONSchema{
	ProjectID:  "proj",
	URL:        "sch_machine",
	ObjectType: new("machine-user"),
}

// stubUserSchemas answers schema reads from schemas: by id, and by objectType
// as the newest-revision list does.
func stubUserSchemas(stmts *servicemocks.MockAllStatements, schemas ...*domain.JSONSchema) {
	stmts.EXPECT().GetJSONSchemaByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _, id string) (*domain.JSONSchema, error) {
			for _, schema := range schemas {
				if schema.URL == id {
					return schema, nil
				}
			}
			return nil, new(database.NoRowFoundError)
		}).AnyTimes()
	stmts.EXPECT().ListJSONSchemas(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, opts *database.ListOptions[domain.JSONSchemaField], _ service.JSONSchemaQueryOptions) (*database.ListResult[*domain.JSONSchema], error) {
			objectType := schemaObjectTypeFilter(opts.Filter)
			out := &database.ListResult[*domain.JSONSchema]{}
			for _, schema := range schemas {
				if schema.ObjectType != nil && *schema.ObjectType == objectType {
					out.Items = append(out.Items, schema)
				}
			}
			return out, nil
		}).AnyTimes()
}

func schemaObjectTypeFilter(filter database.Filter[domain.JSONSchemaField]) string {
	switch f := filter.(type) {
	case database.AndFilter[domain.JSONSchemaField]:
		for _, child := range f.Filters {
			if objectType := schemaObjectTypeFilter(child); objectType != "" {
				return objectType
			}
		}
	case *database.CompareFilter[domain.JSONSchemaField]:
		if len(f.Terms) == 1 && f.Terms[0].Column.Field() == domain.JSONSchemaFieldObjectType {
			return f.Terms[0].Value.(string)
		}
	}
	return ""
}

// stubListFlowDefinitions wires ListFlowDefinitions to filter the given slice
// in-memory the same way the storage layer does.
func stubListFlowDefinitions(t *testing.T, defs []*domain.FlowDefinition) *service.DB {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	stmts.EXPECT().ListFlowDefinitions(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, opts *database.ListOptions[domain.FlowDefinitionField], _ service.FlowDefinitionQueryOptions) (*database.ListResult[*domain.FlowDefinition], error) {
			out := make([]*domain.FlowDefinition, 0, len(defs))
			for _, def := range defs {
				if !matchesFlowDefinitionFilter(def, opts) {
					continue
				}
				out = append(out, def)
			}
			return &database.ListResult[*domain.FlowDefinition]{Items: out}, nil
		},
	).AnyTimes()
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
	case database.OrFilter[domain.FlowDefinitionField]:
		for _, child := range f.Filters {
			if filterMatches(def, child) {
				return true
			}
		}
		return false
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
		default:
			return true
		}
	default:
		return true
	}
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
		UserSchema:    *testUserSchema.ObjectType,
		Purposes:      entries,
		Audience:      audience,
	}
}

// withPinnedSchema is a release that pins one user schema, which is the
// revision a flow start serves.
func withPinnedSchema(t *testing.T, ctx context.Context, handle, revisionID string) context.Context {
	t.Helper()
	return service.WithRuntimeResolution(ctx, &service.RuntimeResolution{
		Release: &domain.Release{Pointers: []domain.ReleasePointer{{
			Kind:       domain.ReleasePointerKindSchema,
			Handle:     handle,
			RevisionID: revisionID,
		}}},
	})
}

// pinnedDefs is a release that pins each definition under its name.
func pinnedDefs(t *testing.T, defs ...*domain.FlowDefinition) context.Context {
	t.Helper()
	pointers := make([]domain.ReleasePointer, 0, len(defs))
	for _, def := range defs {
		pointers = append(pointers, domain.ReleasePointer{
			Kind:       domain.ReleasePointerKindFlowDefinition,
			Handle:     def.Name,
			RevisionID: def.ID,
		})
	}
	return service.WithRuntimeResolution(t.Context(), &service.RuntimeResolution{
		Release: &domain.Release{Pointers: pointers},
	})
}

func TestResolve_NoReleaseIsNotDeployed(t *testing.T) {
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{
		newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin),
	})

	_, err := service.NewFlowService(repo, nil, domain.BuiltinSchemaBases{}, nil).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Name:      new("login"),
	})
	assert.ErrorIs(t, err, domain.ErrReleaseNotDeployed(nil))
}

// A newer revision of the same name is not a candidate. The release names the one that serves.
func TestResolve_ResolveByName_ServesThePinnedRevision(t *testing.T) {
	older := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	older.ID = "flowdef_older"
	older.CreatedAt = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	newer := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	newer.ID = "flowdef_newer"
	newer.CreatedAt = time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)

	repo := stubGetFlowDefinition(t, older, newer)
	got, err := service.NewFlowService(repo, nil, domain.BuiltinSchemaBases{}, nil).Resolve(pinnedDefs(t, older), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Name:      new("login"),
	})
	require.NoError(t, err)
	assert.Same(t, older, got)
}

func TestResolve_ResolveByName_NotFound(t *testing.T) {
	repo := stubGetFlowDefinition(t)
	ctx := service.WithRuntimeResolution(t.Context(), &service.RuntimeResolution{
		Release: &domain.Release{Pointers: []domain.ReleasePointer{{
			Kind:       domain.ReleasePointerKindFlowDefinition,
			Handle:     "missing",
			RevisionID: "flowdef_missing",
		}}},
	})

	_, err := service.NewFlowService(repo, nil, domain.BuiltinSchemaBases{}, nil).Resolve(ctx, service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Name:      new("missing"),
	})
	assert.ErrorIs(t, err, domain.ErrFlowDefinitionNotFound())
}

func TestResolve_ResolveByAudience_NoPinsIsNotFound(t *testing.T) {
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	pool.EXPECT().Statements().Return(servicemocks.NewMockAllStatements(ctrl)).AnyTimes()

	_, err := service.NewFlowService(service.NewPool(pool), nil, domain.BuiltinSchemaBases{}, nil).Resolve(pinnedDefs(t), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
	})
	assert.ErrorIs(t, err, domain.ErrFlowDefinitionNotFound())
	assert.ErrorContains(t, err, "the deployed release pins none")
}

func TestResolve_ResolveByName_NoPinsSaysTheReleasePinsNone(t *testing.T) {
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	pool.EXPECT().Statements().Return(servicemocks.NewMockAllStatements(ctrl)).AnyTimes()

	_, err := service.NewFlowService(service.NewPool(pool), nil, domain.BuiltinSchemaBases{}, nil).Resolve(pinnedDefs(t), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Name:      new("login"),
	})
	assert.ErrorIs(t, err, domain.ErrFlowDefinitionNotFound())
	assert.ErrorContains(t, err, "the deployed release pins none")
}

func TestResolve_ResolveByAudience_RepoErrorPropagates(t *testing.T) {
	sentinel := errors.New("boom")
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	stmts.EXPECT().ListFlowDefinitions(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, sentinel)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	repo := service.NewPool(pool)

	_, err := service.NewFlowService(repo, nil, domain.BuiltinSchemaBases{}, nil).Resolve(pinnedDefs(t, newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
	})
	assert.ErrorIs(t, err, sentinel)
}

// The flow engine chooses among the pinned revisions by the request's
// purpose, version and hint; each one here changes the pick.
func TestResolve_ChoosesByTheRequestsCriteria(t *testing.T) {
	login := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	byApp := newDef("by-app", "1.0.0", domain.FlowDefinitionAudience{AppIDs: []string{"app-1"}}, domain.FlowDefinitionPurposeLogin)
	v2 := newDef("login-v2", "2.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	svc := service.NewFlowService(stubListFlowDefinitions(t, []*domain.FlowDefinition{login, byApp, v2}), nil, domain.BuiltinSchemaBases{}, nil)
	ctx := pinnedDefs(t, login, byApp, v2)

	got, err := svc.Resolve(ctx, service.ResolveFlowRequest{
		ProjectID:     "proj",
		Purpose:       domain.FlowDefinitionPurposeLogin,
		SchemaVersion: new("1.0.0"),
		Hint:          flowengine.EntryHint{AppID: new("app-1")},
	})
	require.NoError(t, err)
	assert.Same(t, byApp, got)

	got, err = svc.Resolve(ctx, service.ResolveFlowRequest{ProjectID: "proj", Purpose: domain.FlowDefinitionPurposeLogin, SchemaVersion: new("2.0.0")})
	require.NoError(t, err)
	assert.Same(t, v2, got)

	_, err = svc.Resolve(ctx, service.ResolveFlowRequest{ProjectID: "proj", Purpose: domain.FlowDefinitionPurposeRegister})
	assert.ErrorIs(t, err, domain.ErrFlowDefinitionNotFound())

	byName := service.NewFlowService(stubGetFlowDefinition(t, login), nil, domain.BuiltinSchemaBases{}, nil)
	_, err = byName.Resolve(pinnedDefs(t, login), service.ResolveFlowRequest{ProjectID: "proj", Purpose: domain.FlowDefinitionPurposeRegister, Name: new("login")})
	assert.ErrorIs(t, err, domain.ErrFlowDefinitionPurposeMismatch())
	_, err = byName.Resolve(pinnedDefs(t, login), service.ResolveFlowRequest{ProjectID: "proj", Purpose: domain.FlowDefinitionPurposeLogin, Name: new("login"), SchemaVersion: new("2.0.0")})
	assert.ErrorIs(t, err, domain.ErrFlowDefinitionNotFound())
}

// fakeStateMachine captures inputs and returns pre-loaded results.
type fakeStateMachine struct {
	startResult   flowengine.StepResult
	startErr      error
	processResult flowengine.StepResult
	processErr    error
	renderResult  flowengine.StepResult
	renderErr     error

	gotStartCtx    context.Context
	gotStartInput  flowengine.StartInput
	gotSubmitInput flowengine.SubmitInput
	gotProcessDef  *domain.FlowDefinition
	gotRenderState *flowengine.State
}

func (f *fakeStateMachine) Start(ctx context.Context, in flowengine.StartInput) (flowengine.StepResult, error) {
	f.gotStartCtx = ctx
	f.gotStartInput = in
	result := namesDefinition(f.startResult, in.Definition.ID)
	if result.State != nil {
		// As the engine does, the state records what the flow started with.
		result.State.ID, result.State.DeploymentID, result.State.ReleaseID = in.ID, in.DeploymentID, in.ReleaseID
	}
	return result, f.startErr
}

func (f *fakeStateMachine) Process(ctx context.Context, defs flowengine.Definitions, state *flowengine.State, in flowengine.SubmitInput) (flowengine.StepResult, error) {
	def, err := flowengine.ActiveDefinition(ctx, defs, state)
	if err != nil {
		return flowengine.StepResult{}, err
	}
	f.gotProcessDef = def
	f.gotSubmitInput = in
	return namesDefinition(f.processResult, state.DefinitionID), f.processErr
}

func (f *fakeStateMachine) Render(ctx context.Context, defs flowengine.Definitions, state *flowengine.State) (flowengine.StepResult, error) {
	if _, err := flowengine.ActiveDefinition(ctx, defs, state); err != nil {
		return flowengine.StepResult{}, err
	}
	f.gotRenderState = state
	return namesDefinition(f.renderResult, state.DefinitionID), f.renderErr
}

// namesDefinition has a canned result's state name the definition the flow
// runs on, as the engine's results do.
func namesDefinition(result flowengine.StepResult, definitionID string) flowengine.StepResult {
	if result.State != nil && result.State.DefinitionID == "" {
		result.State.DefinitionID = definitionID
	}
	return result
}

// stubIDGen returns deterministic prefix_N ids.
type stubIDGen struct {
	calls int
}

func (s *stubIDGen) New(prefix string) (string, error) {
	s.calls++
	return prefix + "_" + strconv.Itoa(s.calls), nil
}

// stubGetFlowDefinition answers GetFlowDefinitionByID from defs and nothing else.
// A name lookup that lists instead of loading the pin fails the test.
func stubGetFlowDefinition(t *testing.T, defs ...*domain.FlowDefinition) *service.DB {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	stmts.EXPECT().GetFlowDefinitionByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, projectID, id string) (*domain.FlowDefinition, error) {
			for _, def := range defs {
				if def.ProjectID == projectID && def.ID == id {
					return def, nil
				}
			}
			return nil, database.NewNoRowFoundError(nil)
		},
	).AnyTimes()
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	return service.NewPool(pool)
}

// stubSubmitDB serves the one read a submission makes: the definition, once.
func stubSubmitDB(t *testing.T, def *domain.FlowDefinition) *service.DB {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	stmts.EXPECT().GetFlowDefinitionByID(gomock.Any(), def.ProjectID, def.ID).Return(def, nil).Times(1)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()
	return service.NewPool(pool)
}

func TestFlowService_Start_MintsFlowAndSessionIDs(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)

	state := &flowengine.State{ProjectID: def.ProjectID}
	sm := &fakeStateMachine{startResult: flowengine.StepResult{State: state, Step: &flowengine.Step{Name: "start"}}}

	svc := service.NewFlowService(stubDB(t), sm, domain.BuiltinSchemaBases{}, nil)

	res, err := svc.Start(withPinnedSchema(t, t.Context(), "human-user", testUserSchema.URL), service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeLogin,
	})
	require.NoError(t, err)
	require.NotNil(t, res.State)
	assert.NotEmpty(t, res.State.ID, "flow id was not minted")
	assert.NotEmpty(t, sm.gotStartInput.Session.ID, "session id was not minted")
	assert.Equal(t, testUserSchema.URL, sm.gotStartInput.UserSchemaURL, "the objectType resolves to the revision")
}

// A flow keeps the deployment and release its start resolved to.
func TestFlowService_Start_PassesTheResolvedDeploymentAndRelease(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	sm := &fakeStateMachine{startResult: flowengine.StepResult{State: &flowengine.State{ProjectID: def.ProjectID}, Step: &flowengine.Step{Name: "start"}}}
	ctx := service.WithRuntimeResolution(t.Context(), &service.RuntimeResolution{
		Deployment: &domain.Deployment{ID: "dep_1"},
		Release: &domain.Release{ID: "rel_1", Pointers: []domain.ReleasePointer{{
			Kind:       domain.ReleasePointerKindSchema,
			Handle:     "human-user",
			RevisionID: testUserSchema.URL,
		}}},
	})

	_, err := service.NewFlowService(stubDB(t), sm, domain.BuiltinSchemaBases{}, nil).Start(ctx, service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeLogin,
	})
	require.NoError(t, err)
	assert.Equal(t, "dep_1", sm.gotStartInput.DeploymentID)
	assert.Equal(t, "rel_1", sm.gotStartInput.ReleaseID)
}

// A flow is a carrier: the engine stores in its sealed state the chain every
// later request of the flow joins. A flow created for an authorization request takes that
// request's chain, so the sign-in an OAuth client asked for is one chain from
// the authorization endpoint on; any other flow starts its own.
func TestFlowService_Start_StoresTheChainInTheState(t *testing.T) {
	start := func(t *testing.T, authRequest *domain.AuthRequest, authRequestID *string) (flowengine.StartInput, context.Context) {
		t.Helper()
		def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
		sm := &fakeStateMachine{startResult: flowengine.StepResult{
			State: &flowengine.State{ProjectID: def.ProjectID}, Step: &flowengine.Step{Name: "start"},
		}}
		ctrl := gomock.NewController(t)
		pool := servicemocks.NewMockPool(ctrl)
		stmts := servicemocks.NewMockAllStatements(ctrl)
		stmts.EXPECT().NewManagedID(gomock.Any()).Return("flow_1", nil).AnyTimes()
		stmts.EXPECT().CreateSession(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
		stubUserSchemas(stmts, testUserSchema)
		if authRequestID != nil {
			read := stmts.EXPECT().GetAuthRequest(gomock.Any(), def.ProjectID, *authRequestID)
			if authRequest == nil {
				read.Return(nil, database.NewNoRowFoundError(nil))
			} else {
				read.Return(authRequest, nil)
			}
		}
		pool.EXPECT().Statements().Return(stmts).AnyTimes()
		svc := service.NewFlowService(service.NewPool(pool), sm, domain.BuiltinSchemaBases{}, nil)

		ctx := withPinnedSchema(t, audit.WithActorSlot(t.Context()), "human-user", testUserSchema.URL)
		_, err := svc.Start(ctx, service.StartFlowRequest{
			Definition:    def,
			Purpose:       domain.FlowDefinitionPurposeLogin,
			AuthRequestID: authRequestID,
		})
		require.NoError(t, err)
		return sm.gotStartInput, sm.gotStartCtx
	}

	t.Run("a flow of its own starts a chain", func(t *testing.T) {
		in, startCtx := start(t, nil, nil)
		assert.Regexp(t, `^[0-9a-f]{32}$`, in.CorrelationID)
		assert.Equal(t, in.CorrelationID, middleware.CorrelationFromContext(startCtx).Chain(),
			"the attempt the state machine creates is in the flow's chain")
	})
	t.Run("a flow for an authorization request joins its chain", func(t *testing.T) {
		id := "authreq_1"
		in, startCtx := start(t, &domain.AuthRequest{ID: id, CorrelationID: "chain_authorize"}, &id)
		assert.Equal(t, "chain_authorize", in.CorrelationID)
		assert.Equal(t, "chain_authorize", middleware.CorrelationFromContext(startCtx).Chain())
	})
	t.Run("an authorization request the project does not hold starts none", func(t *testing.T) {
		id := "authreq_unknown"
		in, _ := start(t, nil, &id)
		assert.Regexp(t, `^[0-9a-f]{32}$`, in.CorrelationID, "the flow still has a chain of its own")
	})
}

// Path B auth.attempt.created runs inside stateMachine.Start. The flow id
// must already be on the actor slot so FromContext can copy flow_id.
func TestFlowService_Start_StampsFlowIDBeforeStateMachine(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	state := &flowengine.State{ProjectID: def.ProjectID}
	sm := &fakeStateMachine{startResult: flowengine.StepResult{State: state, Step: &flowengine.Step{Name: "start"}}}
	svc := service.NewFlowService(stubDB(t), sm, domain.BuiltinSchemaBases{}, nil)

	ctx := withPinnedSchema(t, audit.WithActorSlot(t.Context()), "human-user", testUserSchema.URL)
	res, err := svc.Start(ctx, service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeLogin,
	})
	require.NoError(t, err)

	slot, ok := audit.ActorSlotFromContext(sm.gotStartCtx)
	require.True(t, ok, "state machine Start ctx has no actor slot")
	require.NotNil(t, slot)
	flowID := middleware.CorrelationFromContext(sm.gotStartCtx).Flow()
	require.NotEmpty(t, flowID, "flow_id was not stamped before stateMachine.Start (auth.attempt.created would miss it)")
	require.NotNil(t, res.State)
	assert.Equal(t, res.State.ID, flowID, "stamped flow_id")
	assert.Equal(t, res.State.ID, sm.gotStartInput.ID, "the attempt the state machine creates records this flow")
	require.NotEmpty(t, slot.SessionID, "session_id was not stamped before stateMachine.Start")
	assert.Equal(t, *slot.SessionID, sm.gotStartInput.Session.ID, "stamped session_id")
}

func TestFlowService_Start_PassesRedirectURIThrough(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	state := &flowengine.State{ProjectID: def.ProjectID}
	sm := &fakeStateMachine{startResult: flowengine.StepResult{State: state, Step: &flowengine.Step{}}}

	svc := service.NewFlowService(stubDB(t), sm, domain.BuiltinSchemaBases{}, nil)

	redirect := "https://rp.example.com/cb"
	_, err := svc.Start(withPinnedSchema(t, t.Context(), "human-user", testUserSchema.URL), service.StartFlowRequest{
		Definition:  def,
		Purpose:     domain.FlowDefinitionPurposeLogin,
		RedirectURI: &redirect,
	})
	require.NoError(t, err)
	assert.Equal(t, &redirect, sm.gotStartInput.RedirectURI)
}

func TestFlowService_Start_PreservesProvidedSessionID(t *testing.T) {
	def := newDef("reauth", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeReauth)
	state := &flowengine.State{ProjectID: def.ProjectID}
	sm := &fakeStateMachine{startResult: flowengine.StepResult{State: state, Step: &flowengine.Step{}}}

	// No CreateSession is wired: supplying a session must reuse it, so any call
	// to CreateSession fails the test (proving no new session is created and the
	// existing session's user agent is left untouched).
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	stmts.EXPECT().NewManagedID(gomock.Any()).Return("flow_1", nil).AnyTimes()
	stubUserSchemas(stmts, testUserSchema)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()

	svc := service.NewFlowService(service.NewPool(pool), sm, domain.BuiltinSchemaBases{}, nil)

	sessionID := "sess_explicit"
	_, err := svc.Start(withPinnedSchema(t, t.Context(), "human-user", testUserSchema.URL), service.StartFlowRequest{
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
	state := &flowengine.State{ProjectID: def.ProjectID}
	sm := &fakeStateMachine{startResult: flowengine.StepResult{State: state, Step: &flowengine.Step{}}}

	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	stmts.EXPECT().NewManagedID(gomock.Any()).Return("flow_1", nil).AnyTimes()
	stubUserSchemas(stmts, testUserSchema)
	stmts.EXPECT().CreateSession(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, sess *domain.Session) error {
		// With no supplied session, Start persists one for the flow's project.
		// The anonymous/building nature of a new session is domain.NewSession's
		// contract, covered by the domain and stmttest suites.
		assert.Equal(t, def.ProjectID, sess.ProjectID)
		sess.ID = "sess_created"
		return nil
	}).Times(1)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()

	svc := service.NewFlowService(service.NewPool(pool), sm, domain.BuiltinSchemaBases{}, nil)

	_, err := svc.Start(withPinnedSchema(t, t.Context(), "human-user", testUserSchema.URL), service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeLogin,
	})
	require.NoError(t, err)
	assert.Equal(t, "sess_created", sm.gotStartInput.Session.ID, "want the persisted session id")
}

func TestFlowService_Start_RecordsUserAgent(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	state := &flowengine.State{ProjectID: def.ProjectID}
	sm := &fakeStateMachine{startResult: flowengine.StepResult{State: state, Step: &flowengine.Step{}}}

	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	stmts.EXPECT().NewManagedID(gomock.Any()).Return("flow_1", nil).AnyTimes()
	stubUserSchemas(stmts, testUserSchema)
	stmts.EXPECT().CreateSession(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, sess *domain.Session) error {
		// The request's user agent is recorded on the session the flow creates.
		require.NotNil(t, sess.UserAgent)
		assert.Equal(t, "203.0.113.9", sess.UserAgent.IP)
		sess.ID = "sess_created"
		return nil
	}).Times(1)
	pool.EXPECT().Statements().Return(stmts).AnyTimes()

	svc := service.NewFlowService(service.NewPool(pool), sm, domain.BuiltinSchemaBases{}, nil)

	_, err := svc.Start(withPinnedSchema(t, t.Context(), "human-user", testUserSchema.URL), service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeLogin,
		UserAgent:  &domain.UserAgent{IP: "203.0.113.9", Info: map[string]any{"user_agent": "agent/1"}},
	})
	require.NoError(t, err)
}

func TestFlowService_Start_RejectsEmptySessionID(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	sm := &fakeStateMachine{}

	svc := service.NewFlowService(stubDB(t), sm, domain.BuiltinSchemaBases{}, nil)

	empty := ""
	_, err := svc.Start(withPinnedSchema(t, t.Context(), "human-user", testUserSchema.URL), service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeLogin,
		SessionID:  &empty,
	})
	assert.ErrorIs(t, err, domain.ErrRequestInvalid())
}

func TestFlowService_Start_PropagatesStateMachineError(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	sm := &fakeStateMachine{startErr: errors.New("boom")}

	svc := service.NewFlowService(stubDB(t), sm, domain.BuiltinSchemaBases{}, nil)

	_, err := svc.Start(withPinnedSchema(t, t.Context(), "human-user", testUserSchema.URL), service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeLogin,
	})
	assert.EqualError(t, err, "boom")
}

func TestFlowService_Submit_RefetchesDefinitionAndCallsProcess(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubSubmitDB(t, def)
	processedState := &flowengine.State{ID: "flow_1"}
	sm := &fakeStateMachine{processResult: flowengine.StepResult{State: processedState, Step: &flowengine.Step{Name: "next"}}}

	svc := service.NewFlowService(repo, sm, domain.BuiltinSchemaBases{}, nil)

	state := &flowengine.State{
		ID:            "flow_1",
		ProjectID:     def.ProjectID,
		Progress:      flowengine.Progress{DefinitionID: def.ID},
		AuthAttemptID: "att_1",
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
	repo := stubSubmitDB(t, def)
	expiresAt := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	sm := &fakeStateMachine{processResult: flowengine.StepResult{
		State:                 &flowengine.State{ID: "flow_1"},
		Step:                  &flowengine.Step{Name: "done"},
		HandoffToken:          "ht_abc",
		HandoffTokenExpiresAt: expiresAt,
	}}

	svc := service.NewFlowService(repo, sm, domain.BuiltinSchemaBases{}, nil)

	res, err := svc.Submit(t.Context(), service.SubmitFlowRequest{
		State: &flowengine.State{
			ID:            "flow_1",
			ProjectID:     def.ProjectID,
			Progress:      flowengine.Progress{DefinitionID: def.ID},
			AuthAttemptID: "att_1",
		},
		Action: "submit",
	})
	require.NoError(t, err)
	assert.Equal(t, "ht_abc", res.HandoffToken)
	assert.True(t, res.HandoffTokenExpiresAt.Equal(expiresAt), "HandoffTokenExpiresAt = %v, want %v", res.HandoffTokenExpiresAt, expiresAt)
}

func TestFlowService_Submit_PropagatesSSOReturnAndBindingNonce(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubSubmitDB(t, def)
	sm := &fakeStateMachine{processResult: flowengine.StepResult{
		State:           &flowengine.State{ID: "flow_1"},
		Step:            &flowengine.Step{Name: flowengine.StepNameSSORedirect},
		SSOBindingNonce: "nonce-1",
	}}
	ssoReturn := &domain.FlowSSOReturn{RedirectURI: "https://login.example.test/__nextgen/idp/google/callback", ReturnTarget: "https://login.example.test/login"}

	svc := service.NewFlowService(repo, sm, domain.BuiltinSchemaBases{}, nil)

	res, err := svc.Submit(t.Context(), service.SubmitFlowRequest{
		State: &flowengine.State{
			ID:            "flow_1",
			ProjectID:     def.ProjectID,
			Progress:      flowengine.Progress{DefinitionID: def.ID},
			AuthAttemptID: "att_1",
		},
		Action:        domain.FlowActionSSO,
		SSOProviderID: new("google"),
		SSOReturn:     ssoReturn,
	})
	require.NoError(t, err)
	assert.Equal(t, &flowengine.SSOProviderRef{ID: "google"}, sm.gotSubmitInput.SSOProvider)
	assert.Equal(t, ssoReturn, sm.gotSubmitInput.SSOReturn)
	assert.Equal(t, "nonce-1", res.SSOBindingNonce)
}

func TestFlowService_GetStep_CallsRender(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubGetFlowDefinition(t, def)
	state := &flowengine.State{
		ID:        "flow_1",
		ProjectID: def.ProjectID,
		Progress:  flowengine.Progress{DefinitionID: def.ID},
	}
	sm := &fakeStateMachine{renderResult: flowengine.StepResult{State: state, Step: &flowengine.Step{Name: "identify"}}}

	svc := service.NewFlowService(repo, sm, domain.BuiltinSchemaBases{}, nil)

	res, err := svc.GetStep(t.Context(), service.GetFlowStepRequest{State: state})
	require.NoError(t, err)
	assert.Same(t, state, sm.gotRenderState, "Render was called with the wrong state")
	require.NotNil(t, res.Step)
	assert.Equal(t, "identify", res.Step.Name)
}

func TestFlowService_GetStep_PropagatesHandoffToken(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	repo := stubGetFlowDefinition(t, def)
	state := &flowengine.State{
		ID:        "flow_1",
		ProjectID: def.ProjectID,
		Progress:  flowengine.Progress{DefinitionID: def.ID},
	}
	expiresAt := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	sm := &fakeStateMachine{renderResult: flowengine.StepResult{
		State:                 state,
		Step:                  &flowengine.Step{Name: "done"},
		HandoffToken:          "ht_abc",
		HandoffTokenExpiresAt: expiresAt,
	}}

	res, err := service.NewFlowService(repo, sm, domain.BuiltinSchemaBases{}, nil).GetStep(t.Context(), service.GetFlowStepRequest{State: state})
	require.NoError(t, err)
	assert.Equal(t, "ht_abc", res.HandoffToken)
	assert.True(t, res.HandoffTokenExpiresAt.Equal(expiresAt))
}

// A definition may name its user schema by a built-in schema's `$id` under a
// base the project was not seeded under: start pins the row the project
// stores under the other base, the way flow-definition create resolves it.
func TestFlowService_Start_ResolvesBuiltinSchemaUnderAnotherBase(t *testing.T) {
	bases := domain.NewBuiltinSchemaBases("https://schemas.test/builtin/v1", "https://schemas.test/builtin/v0")
	stored := &domain.JSONSchema{
		ProjectID:  "proj",
		URL:        "https://schemas.test/builtin/v1/default-human-user.json",
		ObjectType: new("human-user"),
	}
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	def.UserSchema = "https://schemas.test/builtin/v0/default-human-user.json"
	state := &flowengine.State{ProjectID: def.ProjectID}
	sm := &fakeStateMachine{startResult: flowengine.StepResult{State: state, Step: &flowengine.Step{Name: "start"}}}

	_, err := service.NewFlowService(stubDBWithSchemas(t, stored), sm, bases, nil).Start(withPinnedSchema(t, t.Context(), "human-user", stored.URL), service.StartFlowRequest{
		Definition: def,
		Purpose:    domain.FlowDefinitionPurposeLogin,
	})
	require.NoError(t, err)
	assert.Equal(t, stored.URL, sm.gotStartInput.UserSchemaURL)
}

// countingSignupProtection counts the challenges a render asks the guard for.
type countingSignupProtection struct {
	stubSignupProtection
	issued int
}

func (c *countingSignupProtection) Challenge(context.Context, *flowengine.State) (*pow.PublicChallenge, error) {
	c.issued++
	return &pow.PublicChallenge{ChallengeID: "ch_pow"}, nil
}

// A render of a step that announces the sign-up gate prepares its puzzle; one
// that does not asks for none.
func TestFlowService_GetStep_PreparesThePuzzleOfAGatedStep(t *testing.T) {
	for _, gated := range []bool{true, false} {
		def := newDef("register", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeRegister)
		state := &flowengine.State{ID: "flow-1", ProjectID: def.ProjectID, Progress: flowengine.Progress{DefinitionID: def.ID}, AuthAttemptID: "att-1"}
		sm := &fakeStateMachine{renderResult: flowengine.StepResult{State: state, Step: &flowengine.Step{Name: "start", SignupRequired: gated}}}
		protection := &countingSignupProtection{}

		res, err := service.NewFlowService(stubGetFlowDefinition(t, def), sm, domain.BuiltinSchemaBases{}, protection).
			GetStep(t.Context(), service.GetFlowStepRequest{State: state})
		require.NoError(t, err)
		if gated {
			assert.Equal(t, 1, protection.issued)
			require.NotNil(t, res.Step.SignupChallenge)
		} else {
			assert.Zero(t, protection.issued)
			assert.Nil(t, res.Step.SignupChallenge)
		}
	}
}

func TestFlowService_SignupIssuanceCannotDiscardTransition(t *testing.T) {
	def := newDef("register", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeRegister)
	def.Steps = []domain.FlowDefinitionStep{{Name: "start", OnSuccess: new(domain.FlowOnSuccessCreateUser)}}
	state := &flowengine.State{ProjectID: def.ProjectID, Progress: flowengine.Progress{DefinitionID: def.ID}, AuthAttemptID: "attempt"}
	result := flowengine.StepResult{State: state, Step: &flowengine.Step{Name: "start", SignupRequired: true}}
	sm := &fakeStateMachine{startResult: result, processResult: result, renderResult: result}
	protection := stubSignupProtection{err: domain.ErrFlowRateLimited()}
	svc := service.NewFlowService(stubDB(t), sm, domain.BuiltinSchemaBases{}, protection)
	started, err := svc.Start(withPinnedSchema(t, t.Context(), "human-user", testUserSchema.URL), service.StartFlowRequest{Definition: def, Purpose: domain.FlowDefinitionPurposeRegister})
	require.NoError(t, err)
	require.True(t, started.Step.SignupRequired)
	require.Nil(t, started.Step.SignupChallenge)
	svc = service.NewFlowService(stubSubmitDB(t, def), sm, domain.BuiltinSchemaBases{}, protection)
	submitted, err := svc.Submit(t.Context(), service.SubmitFlowRequest{State: state, Action: "submit"})
	require.NoError(t, err)
	require.Same(t, state, submitted.State)
	require.True(t, submitted.Step.SignupRequired)
	// A GET that advances parked SSO state must also preserve its new cookie.
	sm.renderResult.Reseal = true
	svc = service.NewFlowService(stubGetFlowDefinition(t, def), sm, domain.BuiltinSchemaBases{}, protection)
	rendered, err := svc.GetStep(t.Context(), service.GetFlowStepRequest{State: state})
	require.NoError(t, err)
	require.True(t, rendered.Reseal)
	sm.renderResult.Reseal = false
	// Issuance is a separate retryable read, after the advanced cookie is returned.
	svc = service.NewFlowService(stubGetFlowDefinition(t, def), sm, domain.BuiltinSchemaBases{}, protection)
	_, err = svc.GetStep(t.Context(), service.GetFlowStepRequest{State: state})
	require.ErrorIs(t, err, domain.ErrFlowRateLimited())
}
