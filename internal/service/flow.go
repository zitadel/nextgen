package service

import (
	"context"
	"fmt"
	"net/url"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// FlowService is the flow engine's use-case surface. The API handler
// depends only on this interface.
type FlowService interface {
	// Resolve returns the [domain.FlowDefinition] to run. Direct lookup
	// when Name is set; audience match otherwise.
	Resolve(ctx context.Context, req ResolveFlowRequest) (*domain.FlowDefinition, error)
	// Start mints a fresh flow on the resolved definition.
	Start(ctx context.Context, req StartFlowRequest) (FlowStepResult, error)
	// Submit advances the state machine. Re-fetches the definition
	// from FlowState.DefinitionID.
	Submit(ctx context.Context, req SubmitFlowRequest) (FlowStepResult, error)
	// GetStep re-emits the current step without advancing.
	GetStep(ctx context.Context, req GetFlowStepRequest) (FlowStepResult, error)
}

type StartFlowRequest struct {
	Definition    *domain.FlowDefinition
	Purpose       domain.FlowDefinitionPurpose
	RedirectURI   *url.URL
	AuthRequestID *string
	SessionID     *string
}

type SubmitFlowRequest struct {
	State         *domain.FlowState
	Action        string
	Fields        map[string]any
	GateProofs    map[string]string
	SSOProviderID *string
	// ChallengeResponse carries the client's answer to a pending ceremony
	// (e.g. a passkey assertion). Nil unless the step issued a challenge.
	ChallengeResponse *FlowChallengeResponse
	// PasskeyRP carries the WebAuthn relying-party params derived from the
	// request, needed when issuing a passkey challenge.
	PasskeyRP *FlowPasskeyRP
}

type GetFlowStepRequest struct {
	State *domain.FlowState
}

type ResolveFlowRequest struct {
	ProjectID     string
	Purpose       domain.FlowDefinitionPurpose
	Name          *string // direct-lookup slug
	SchemaVersion *string // nil = latest active
	AuthRequestID *string
	// Hint is plumbed through but not yet honored — see TODO on resolveByAudience.
	Hint ResolveFlowHint
}

type ResolveFlowHint struct {
	AppID        *string
	TeamID       *string
	UserSchemaID *string
}

func NewFlowService(
	pool database.Pool,
	flowDefs domain.FlowDefinitionRepository,
	stateMachine FlowStateMachine,
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
	stateMachine FlowStateMachine
	ids          idgen.Generator
}

var _ FlowService = (*flowService)(nil)

func (s *flowService) Resolve(ctx context.Context, req ResolveFlowRequest) (*domain.FlowDefinition, error) {
	if req.Name != nil {
		return s.resolveByName(ctx, req)
	}
	return s.resolveByAudience(ctx, req)
}

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

// TODO: honor ResolveFlowRequest.Hint — score by AppIDs > TeamIDs > project-wide,
// tie-break by created_at DESC.
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

	// TODO(wim): use SessionService to create sessions
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

	in := FlowStartInput{
		Definition:    req.Definition,
		Purpose:       req.Purpose,
		Session:       FlowSessionRef{ID: sessionID},
		RedirectURI:   req.RedirectURI,
		UserSchemaURL: req.Definition.UserSchema,
	}
	if req.AuthRequestID != nil {
		in.AuthRequest = &FlowAuthRequestRef{ID: *req.AuthRequestID}
	}

	result, err := s.stateMachine.Start(ctx, s.pool, in)
	if err != nil {
		return FlowStepResult{}, err
	}

	// TODO(wim): move id-generation to domain
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
	in := FlowSubmitInput{
		Action:            req.Action,
		Fields:            req.Fields,
		GateProofs:        req.GateProofs,
		ChallengeResponse: req.ChallengeResponse,
		PasskeyRP:         req.PasskeyRP,
	}
	if req.SSOProviderID != nil {
		in.SSOProvider = &FlowSSOProviderRef{ID: *req.SSOProviderID}
	}
	result, err := s.stateMachine.Process(ctx, s.pool, def, req.State, in)
	if err != nil {
		return FlowStepResult{}, err
	}
	return FlowStepResult{
		State:                 result.State,
		Step:                  result.Step,
		HandoffToken:          result.HandoffToken,
		HandoffTokenExpiresAt: result.HandoffTokenExpiresAt,
	}, nil
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

// pickLatestFlowVersion is a lexicographic compare — sufficient while
// versions stay zero-padded MAJOR.MINOR.PATCH. Caller ensures defs non-empty.
func pickLatestFlowVersion(defs []*domain.FlowDefinition) *domain.FlowDefinition {
	winner := defs[0]
	for _, def := range defs[1:] {
		if def.SchemaVersion > winner.SchemaVersion {
			winner = def
		}
	}
	return winner
}
