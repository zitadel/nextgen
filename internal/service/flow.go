package service

import (
	"context"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// FlowService is the flow engine's use-case surface. The API handler
// depends only on this interface — never on the state machine or
// repositories directly.
type FlowService interface {
	// Resolve returns the [domain.FlowDefinition] to run for an incoming
	// flow request. Read-only — never touches sessions or cookies.
	//
	// Resolution algorithm:
	//
	//  1. If [ResolveFlowRequest.Name] is set, look up by
	//     (ProjectID, Name, SchemaVersion?), pick the highest version,
	//     and confirm the requested purpose is served. Return
	//     [domain.ErrFlowDefinitionNotFound] or
	//     [domain.ErrFlowDefinitionPurposeMismatch] on miss.
	//  2. Otherwise return the first active definition whose purposes
	//     include [ResolveFlowRequest.Purpose] (optionally pinned to
	//     [ResolveFlowRequest.SchemaVersion]). [ResolveFlowRequest.Hint]
	//     is plumbed through but not yet honored — see TODO on
	//     resolveByAudience.
	Resolve(ctx context.Context, req ResolveFlowRequest) (*domain.FlowDefinition, error)

	// Start mints a fresh flow on top of the resolved definition. The
	// returned [FlowStepResult] carries the initial step plus a
	// [domain.FlowState] with [domain.FlowState.ID] and
	// [domain.FlowState.SessionID] populated.
	Start(ctx context.Context, req StartFlowRequest) (FlowStepResult, error)

	// Submit drives a single client submission through the state
	// machine. The handler is responsible for opening + resealing the
	// cookie; this method just re-fetches the definition by
	// [domain.FlowState.DefinitionID] and calls Process.
	Submit(ctx context.Context, req SubmitFlowRequest) (FlowStepResult, error)

	// GetStep re-emits the current step without advancing. Backs
	// `GET /flow/{id}` so page refreshes don't consume transitions.
	GetStep(ctx context.Context, req GetFlowStepRequest) (FlowStepResult, error)
}

// FlowStepResult is the service-layer projection of
// [domain.FlowStepResult]. Handlers receive a single shape regardless
// of whether the result came from Start, Submit, or GetStep.
type FlowStepResult struct {
	State *domain.FlowState
	Step  *domain.FlowStep
}

// StartFlowRequest carries the inputs to [FlowService.Start]. The
// resolved definition is passed back in by the handler so Start does
// not re-walk the resolution algorithm.
type StartFlowRequest struct {
	Definition    *domain.FlowDefinition
	Purpose       domain.FlowDefinitionPurpose
	RedirectURI   *string
	AuthRequestID *string
	SessionID     *string
}

// SubmitFlowRequest carries one client submission. State is the cookie
// payload the handler decoded for this request.
type SubmitFlowRequest struct {
	State         *domain.FlowState
	Action        string
	Fields        map[string]any
	GateProofs    map[string]string
	SSOProviderID *string
}

// GetFlowStepRequest carries the cookie payload for a refresh.
type GetFlowStepRequest struct {
	State *domain.FlowState
}

// ResolveFlowRequest is the input to [FlowService.Resolve].
type ResolveFlowRequest struct {
	ProjectID string
	Purpose   domain.FlowDefinitionPurpose

	// Name, when set, switches to direct lookup. It acts as a slug.
	Name *string

	// SchemaVersion is a semver string. Nil means "latest active".
	SchemaVersion *string

	// AuthRequestID carries the OIDC/SAML request ID when the flow was
	// initiated by a downstream protocol handler.
	AuthRequestID *string

	// Hint narrows audience matching when no direct lookup is in play.
	// Currently ignored — see TODO on resolveByAudience.
	Hint ResolveFlowHint
}

// ResolveFlowHint carries the audience-narrowing context derived from the
// request or the auth-request that initiated it. Empty fields are ignored
// during matching.
type ResolveFlowHint struct {
	AppID        *string
	TeamID       *string
	UserSchemaID *string
}

// NewFlowService returns a [FlowService] composing the definition
// repository, the state machine, and an ID generator. The pool is the
// [database.QueryExecutor] for every read.
func NewFlowService(
	pool database.Pool,
	flowDefs domain.FlowDefinitionRepository,
	stateMachine domain.FlowStateMachine,
	ids idgen.Generator,
) FlowService {
	return &flowService{
		pool:         pool,
		flowDefs:     flowDefs,
		stateMachine: stateMachine,
		ids:          ids,
	}
}

type flowService struct {
	pool         database.Pool
	flowDefs     domain.FlowDefinitionRepository
	stateMachine domain.FlowStateMachine
	ids          idgen.Generator
}

var _ FlowService = (*flowService)(nil)

func (s *flowService) Resolve(ctx context.Context, req ResolveFlowRequest) (*domain.FlowDefinition, error) {
	if req.Name != nil {
		return s.resolveByName(ctx, req)
	}
	return s.resolveByAudience(ctx, req)
}

// resolveByName implements the direct-lookup branch: list active definitions
// matching (ProjectID, Name, SchemaVersion?), pick the latest version, then
// confirm the requested purpose is served.
func (s *flowService) resolveByName(ctx context.Context, req ResolveFlowRequest) (*domain.FlowDefinition, error) {
	opts := []domain.FlowDefinitionListOption{
		domain.WithFlowDefinitionName(*req.Name),
		domain.WithFlowDefinitionStatus(domain.FlowDefinitionStatusActive),
	}
	if req.SchemaVersion != nil {
		opts = append(opts, domain.WithSchemaVersion(*req.SchemaVersion))
	}

	defs, err := s.flowDefs.ListFlowDefinitions(ctx, s.pool, req.ProjectID, opts...)
	if err != nil {
		return nil, err
	}
	if len(defs) == 0 {
		return nil, domain.ErrFlowDefinitionNotFound()
	}

	def := pickLatestFlowVersion(defs)
	if !flowServesPurpose(def, req.Purpose) {
		return nil, domain.ErrFlowDefinitionPurposeMismatch()
	}
	return def, nil
}

// resolveByAudience picks the first active definition serving the requested
// purpose (with an optional SchemaVersion pin).
//
// TODO: honor [ResolveFlowRequest.Hint]. The MVP returns whichever row the
// repository yields first; once admin UX produces multiple audience-targeted
// definitions per purpose, score candidates by AppIDs > TeamIDs >
// project-wide (both empty) and tie-break by created_at DESC.
func (s *flowService) resolveByAudience(ctx context.Context, req ResolveFlowRequest) (*domain.FlowDefinition, error) {
	opts := []domain.FlowDefinitionListOption{
		domain.WithFlowDefinitionStatus(domain.FlowDefinitionStatusActive),
		domain.WithFlowDefinitionPurpose(req.Purpose),
	}
	if req.SchemaVersion != nil {
		opts = append(opts, domain.WithSchemaVersion(*req.SchemaVersion))
	}

	defs, err := s.flowDefs.ListFlowDefinitions(ctx, s.pool, req.ProjectID, opts...)
	if err != nil {
		return nil, err
	}
	if len(defs) == 0 {
		return nil, domain.ErrFlowDefinitionNotFound()
	}
	return defs[0], nil
}

func (s *flowService) Start(ctx context.Context, req StartFlowRequest) (FlowStepResult, error) {
	if req.Definition == nil {
		return FlowStepResult{}, fmt.Errorf("flow service: start without definition")
	}

	sessionID := ""
	if req.SessionID != nil {
		sessionID = *req.SessionID
	} else {
		id, err := s.ids.New("sess")
		if err != nil {
			return FlowStepResult{}, fmt.Errorf("flow service: mint session id: %w", err)
		}
		sessionID = id
	}

	in := domain.FlowStartInput{
		Definition:    req.Definition,
		Purpose:       req.Purpose,
		Session:       domain.FlowSessionRef{ID: sessionID},
		RedirectURI:   req.RedirectURI,
		UserSchemaURL: req.Definition.UserSchema,
	}
	if req.AuthRequestID != nil {
		in.AuthRequest = &domain.FlowAuthRequestRef{ID: *req.AuthRequestID}
	}

	result, err := s.stateMachine.Start(ctx, s.pool, in)
	if err != nil {
		return FlowStepResult{}, err
	}

	flowID, err := s.ids.New("flow")
	if err != nil {
		return FlowStepResult{}, fmt.Errorf("flow service: mint flow id: %w", err)
	}
	result.State.ID = flowID

	return FlowStepResult{State: result.State, Step: result.Step}, nil
}

func (s *flowService) Submit(ctx context.Context, req SubmitFlowRequest) (FlowStepResult, error) {
	if req.State == nil {
		return FlowStepResult{}, fmt.Errorf("flow service: submit without state")
	}
	def, err := s.flowDefs.GetFlowDefinition(ctx, s.pool, req.State.ProjectID, req.State.DefinitionID)
	if err != nil {
		return FlowStepResult{}, err
	}
	in := domain.FlowSubmitInput{
		Action:     req.Action,
		Fields:     req.Fields,
		GateProofs: req.GateProofs,
	}
	if req.SSOProviderID != nil {
		in.SSOProvider = &domain.FlowSSOProviderRef{ID: *req.SSOProviderID}
	}
	result, err := s.stateMachine.Process(ctx, s.pool, def, req.State, in)
	if err != nil {
		return FlowStepResult{}, err
	}
	return FlowStepResult{State: result.State, Step: result.Step}, nil
}

func (s *flowService) GetStep(ctx context.Context, req GetFlowStepRequest) (FlowStepResult, error) {
	if req.State == nil {
		return FlowStepResult{}, fmt.Errorf("flow service: get step without state")
	}
	def, err := s.flowDefs.GetFlowDefinition(ctx, s.pool, req.State.ProjectID, req.State.DefinitionID)
	if err != nil {
		return FlowStepResult{}, err
	}
	result, err := s.stateMachine.Render(ctx, s.pool, def, req.State)
	if err != nil {
		return FlowStepResult{}, err
	}
	return FlowStepResult{State: result.State, Step: result.Step}, nil
}

func flowServesPurpose(def *domain.FlowDefinition, purpose domain.FlowDefinitionPurpose) bool {
	_, ok := def.Purposes[purpose]
	return ok
}

// pickLatestFlowVersion returns the definition with the highest SchemaVersion
// among defs. Uses lexicographic compare — sufficient while versions stay
// zero-padded single-digit MAJOR.MINOR.PATCH (MVP scope). Caller must
// ensure defs is non-empty.
func pickLatestFlowVersion(defs []*domain.FlowDefinition) *domain.FlowDefinition {
	winner := defs[0]
	for _, def := range defs[1:] {
		if def.SchemaVersion > winner.SchemaVersion {
			winner = def
		}
	}
	return winner
}
