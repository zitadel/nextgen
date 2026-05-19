package service

import (
	"context"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// FlowService is the flow engine's use-case surface. Resolve picks the
// definition; Start, Submit, and GetStep drive a single live flow. The
// handler keeps a single dependency on this service and never talks to
// the state machine directly.
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

	// Start mints a fresh flow on top of the resolved definition. It
	// generates the flow handle + session id, builds the initial
	// [domain.FlowState], and renders the entry step. The caller seals
	// the returned state into the `_zflow` cookie and emits the rendered
	// step as the response body.
	Start(ctx context.Context, req StartFlowRequest) (domain.FlowStepResult, error)

	// Submit advances the current flow by one user submission. The
	// caller decodes the cookie into [SubmitFlowRequest.State]; the
	// service re-fetches the definition by [domain.FlowProgress.DefinitionID]
	// so the handler is not forced to re-call Resolve.
	Submit(ctx context.Context, req SubmitFlowRequest) (domain.FlowStepResult, error)

	// GetStep re-emits the current step without advancing. Used by the
	// GET /flow/{id} handler to refresh a stale client view.
	GetStep(ctx context.Context, req GetFlowStepRequest) (domain.FlowStepResult, error)
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

// StartFlowRequest is the input to [FlowService.Start]. The definition
// is supplied by the caller — the handler passes back the pointer
// Resolve returned so the service does not re-query storage.
type StartFlowRequest struct {
	Definition  *domain.FlowDefinition
	Purpose     domain.FlowDefinitionPurpose
	Hint        ResolveFlowHint
	RedirectURI *string
	AuthRequest *domain.FlowAuthRequestRef
}

// SubmitFlowRequest is the input to [FlowService.Submit]. State is the
// decoded cookie payload; the service re-fetches the definition by
// [domain.FlowProgress.DefinitionID].
type SubmitFlowRequest struct {
	State         *domain.FlowState
	Action        string
	Fields        map[string]any
	GateProofs    map[string]string
	SSOProviderID *string
}

// GetFlowStepRequest is the input to [FlowService.GetStep]. State is the
// decoded cookie payload.
type GetFlowStepRequest struct {
	State *domain.FlowState
}

// NewFlowService returns a [FlowService] backed by the given repository,
// state machine, and id generator. The pool is used as the
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
// definitions per purpose, score candidates by AppID > TeamID > UserSchemaID
// > IsProjectDefault and tie-break by created_at DESC.
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

func (s *flowService) Start(ctx context.Context, req StartFlowRequest) (domain.FlowStepResult, error) {
	if req.Definition == nil {
		return domain.FlowStepResult{}, fmt.Errorf("flow service: start without definition")
	}

	flowID, err := s.ids.New("flow")
	if err != nil {
		return domain.FlowStepResult{}, fmt.Errorf("flow service: mint flow id: %w", err)
	}
	sessionID, err := s.ids.New("sess")
	if err != nil {
		return domain.FlowStepResult{}, fmt.Errorf("flow service: mint session id: %w", err)
	}

	in := domain.FlowStartInput{
		Definition:    req.Definition,
		Purpose:       req.Purpose,
		Session:       domain.FlowSessionRef{ID: sessionID},
		AuthRequest:   req.AuthRequest,
		RedirectURI:   req.RedirectURI,
		Hint:          domain.FlowHint{AppID: req.Hint.AppID, TeamID: req.Hint.TeamID, UserSchemaID: req.Hint.UserSchemaID},
		UserSchemaURL: req.Definition.UserSchema,
	}

	result, err := s.stateMachine.Start(ctx, s.pool, in)
	if err != nil {
		return domain.FlowStepResult{}, err
	}
	result.State.ID = flowID
	return result, nil
}

func (s *flowService) Submit(ctx context.Context, req SubmitFlowRequest) (domain.FlowStepResult, error) {
	if req.State == nil {
		return domain.FlowStepResult{}, fmt.Errorf("flow service: submit without state")
	}

	def, err := s.flowDefs.GetFlowDefinition(ctx, s.pool, req.State.ProjectID, req.State.DefinitionID)
	if err != nil {
		return domain.FlowStepResult{}, err
	}

	in := domain.FlowSubmitInput{
		Action:     req.Action,
		Fields:     req.Fields,
		GateProofs: req.GateProofs,
	}
	if req.SSOProviderID != nil {
		in.SSOProvider = &domain.FlowSSOProviderRef{ID: *req.SSOProviderID}
	}

	return s.stateMachine.Process(ctx, s.pool, def, req.State, in)
}

func (s *flowService) GetStep(ctx context.Context, req GetFlowStepRequest) (domain.FlowStepResult, error) {
	if req.State == nil {
		return domain.FlowStepResult{}, fmt.Errorf("flow service: getstep without state")
	}

	def, err := s.flowDefs.GetFlowDefinition(ctx, s.pool, req.State.ProjectID, req.State.DefinitionID)
	if err != nil {
		return domain.FlowStepResult{}, err
	}

	return s.stateMachine.Render(ctx, s.pool, def, req.State)
}

func flowServesPurpose(def *domain.FlowDefinition, purpose domain.FlowDefinitionPurpose) bool {
	for _, p := range def.Purposes {
		if p.Purpose == purpose {
			return true
		}
	}
	return false
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
