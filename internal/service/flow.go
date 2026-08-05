package service

import (
	"context"
	"fmt"
	"slices"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// FlowService is the flow engine's use-case surface. The API handler
// depends only on this interface.
type FlowService interface {
	// Resolve returns the [domain.FlowDefinition] to run. Direct lookup
	// when Name is set; audience match otherwise.
	Resolve(ctx context.Context, req ResolveFlowRequest) (*domain.FlowDefinition, error)
	// Start mints a fresh flow on the resolved definition.
	Start(ctx context.Context, req StartFlowRequest) (domain.FlowStepResult, error)
	// Submit advances the state machine. Re-fetches the definition
	// from FlowState.DefinitionID.
	Submit(ctx context.Context, req SubmitFlowRequest) (domain.FlowStepResult, error)
	// GetStep re-emits the current step without advancing.
	GetStep(ctx context.Context, req GetFlowStepRequest) (domain.FlowStepResult, error)
}

type StartFlowRequest struct {
	Definition    *domain.FlowDefinition
	Purpose       domain.FlowDefinitionPurpose
	RedirectURI   *string
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
	ChallengeResponse *domain.FlowChallengeResponse
	// PasskeyRP carries the WebAuthn relying-party params derived from the
	// request, needed when issuing a passkey challenge.
	PasskeyRP *domain.FlowPasskeyRP
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
	// Hint scopes audience resolution (ignored when Name is set) — see
	// resolveByAudience for the scoring rules.
	Hint ResolveFlowHint
}

type ResolveFlowHint struct {
	AppID        *string
	TeamID       *string
	UserSchemaID *string
}

func NewFlowService(
	v2Pool *DB,
	stateMachine domain.FlowStateMachine,
) FlowService {
	return &flowService{
		v2Pool:       v2Pool,
		stateMachine: stateMachine,
	}
}

type flowService struct {
	v2Pool       *DB
	stateMachine domain.FlowStateMachine
}

var _ FlowService = (*flowService)(nil)

func (s *flowService) Resolve(ctx context.Context, req ResolveFlowRequest) (*domain.FlowDefinition, error) {
	if req.Name != nil {
		return s.resolveByName(ctx, req)
	}
	return s.resolveByAudience(ctx, req)
}

func (s *flowService) resolveByName(ctx context.Context, req ResolveFlowRequest) (*domain.FlowDefinition, error) {
	filters := []database.Filter[domain.FlowDefinitionField]{
		database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), req.ProjectID),
		database.Equal(database.Col(domain.FlowDefinitionFieldName), *req.Name),
		database.Equal(database.Col(domain.FlowDefinitionFieldStatus), domain.FlowDefinitionStatusActive.String()),
	}
	if req.SchemaVersion != nil {
		filters = append(filters, database.Equal(database.Col(domain.FlowDefinitionFieldSchemaVersion), *req.SchemaVersion))
	}

	result, err := s.v2Pool.Statements().ListFlowDefinitions(ctx, &database.ListOptions[domain.FlowDefinitionField]{
		Filter: database.And(filters...),
	})
	if err != nil {
		return nil, err
	}
	if len(result.Items) == 0 {
		return nil, domain.ErrFlowDefinitionNotFound()
	}

	def := pickLatestFlowVersion(result.Items)
	if !flowServesPurpose(def, req.Purpose) {
		return nil, domain.ErrFlowDefinitionPurposeMismatch()
	}
	return def, nil
}

// resolveByAudience picks the active definition whose audience most
// specifically matches the request hint.
//
// A user_schema_id hint is a hard filter: only definitions operating on
// that schema stay candidates. The remaining candidates are scored
// app match > team match > project-wide (unscoped); definitions scoped
// to other apps/teams rank below unscoped so a targeted flow never
// captures the project default. Hints are client-supplied routing
// suggestions, not a security boundary — with no eligible tier above
// them, scoped definitions still resolve rather than failing the login.
// Ties break newest-first (created_at, then id, so one bulk apply with
// colliding timestamps still yields a stable pick).
func (s *flowService) resolveByAudience(ctx context.Context, req ResolveFlowRequest) (*domain.FlowDefinition, error) {
	filters := []database.Filter[domain.FlowDefinitionField]{
		database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), req.ProjectID),
		database.Equal(database.Col(domain.FlowDefinitionFieldStatus), domain.FlowDefinitionStatusActive.String()),
		database.ArrayContains(database.Col(domain.FlowDefinitionFieldPurposes), req.Purpose.String()),
	}
	if req.SchemaVersion != nil {
		filters = append(filters, database.Equal(database.Col(domain.FlowDefinitionFieldSchemaVersion), *req.SchemaVersion))
	}

	result, err := s.v2Pool.Statements().ListFlowDefinitions(ctx, &database.ListOptions[domain.FlowDefinitionField]{
		Filter: database.And(filters...),
	})
	if err != nil {
		return nil, err
	}
	var best *domain.FlowDefinition
	bestScore := -1
	for _, def := range result.Items {
		if req.Hint.UserSchemaID != nil && def.UserSchema != *req.Hint.UserSchemaID {
			continue
		}
		score := flowAudienceScore(def, req.Hint)
		if score > bestScore || (score == bestScore && flowCreatedAfter(def, best)) {
			best, bestScore = def, score
		}
	}
	if best == nil {
		return nil, domain.ErrFlowDefinitionNotFound()
	}
	return best, nil
}

// flowAudienceScore ranks def for the hinted request: 3 for a hinted-app
// match, 2 for a hinted-team match, 1 for an unscoped (project-wide)
// definition, 0 for a definition scoped to apps/teams the hint does not
// identify.
func flowAudienceScore(def *domain.FlowDefinition, hint ResolveFlowHint) int {
	switch {
	case hint.AppID != nil && slices.Contains(def.Audience.AppIDs, *hint.AppID):
		return 3
	case hint.TeamID != nil && slices.Contains(def.Audience.TeamIDs, *hint.TeamID):
		return 2
	case len(def.Audience.AppIDs) == 0 && len(def.Audience.TeamIDs) == 0:
		return 1
	default:
		return 0
	}
}

// flowCreatedAfter reports whether a was created after b (id as the
// timestamp tie-break).
func flowCreatedAfter(a, b *domain.FlowDefinition) bool {
	if !a.CreatedAt.Equal(b.CreatedAt) {
		return a.CreatedAt.After(b.CreatedAt)
	}
	return a.ID > b.ID
}

// resolveFlowSession returns the id of the session the flow runs against: the
// one the client supplied (a pre-created anonymous session, or an existing
// session for step-up), or a freshly persisted anonymous session when none is
// supplied. Linking the auth-attempt to this session lets exchange upgrade it in
// place (building -> active) instead of minting a second one.
//
// It persists through the statement pool rather than SessionService because the
// pool is flowService's only persistence port — every other storage access here
// already goes through s.v2Pool.Statements() — so routing session creation
// through SessionService would add a service-to-service dependency for no gain.
// (domain.NewSession only builds the value; it cannot persist.)
func (s *flowService) resolveFlowSession(ctx context.Context, req StartFlowRequest) (string, error) {
	if req.SessionID != nil {
		return *req.SessionID, nil
	}
	session, err := domain.NewSession(req.Definition.ProjectID, nil)
	if err != nil {
		return "", fmt.Errorf("flow service: create anonymous session: %w", err)
	}
	if err := s.v2Pool.Statements().CreateSession(ctx, session); err != nil {
		return "", fmt.Errorf("flow service: persist anonymous session: %w", err)
	}
	return session.ID, nil
}

func (s *flowService) Start(ctx context.Context, req StartFlowRequest) (domain.FlowStepResult, error) {
	if req.Definition == nil {
		return domain.FlowStepResult{}, fmt.Errorf("flow service: start without definition")
	}

	sessionID, err := s.resolveFlowSession(ctx, req)
	if err != nil {
		return domain.FlowStepResult{}, err
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

	result, err := s.stateMachine.Start(ctx, in)
	if err != nil {
		return domain.FlowStepResult{}, err
	}

	flowID, err := s.v2Pool.Statements().NewManagedID(string(domain.PrefixFlow))
	if err != nil {
		return domain.FlowStepResult{}, fmt.Errorf("flow service: mint flow id: %w", err)
	}
	result.State.ID = flowID

	return domain.FlowStepResult{State: result.State, Step: result.Step}, nil
}

func (s *flowService) Submit(ctx context.Context, req SubmitFlowRequest) (domain.FlowStepResult, error) {
	if req.State == nil {
		return domain.FlowStepResult{}, fmt.Errorf("flow service: submit without state")
	}
	// todo: gracefully handle when the definition was updated (status, steps, etc.,) since the flow started
	def, err := s.v2Pool.Statements().GetFlowDefinitionByID(ctx, req.State.ProjectID, req.State.DefinitionID)
	if err != nil {
		return domain.FlowStepResult{}, err
	}
	in := domain.FlowSubmitInput{
		Action:            req.Action,
		Fields:            req.Fields,
		GateProofs:        req.GateProofs,
		ChallengeResponse: req.ChallengeResponse,
		PasskeyRP:         req.PasskeyRP,
	}
	if req.SSOProviderID != nil {
		in.SSOProvider = &domain.FlowSSOProviderRef{ID: *req.SSOProviderID}
	}
	result, err := s.stateMachine.Process(ctx, def, req.State, in)
	if err != nil {
		return domain.FlowStepResult{}, err
	}
	return domain.FlowStepResult{
		State:                 result.State,
		Step:                  result.Step,
		HandoffToken:          result.HandoffToken,
		HandoffTokenExpiresAt: result.HandoffTokenExpiresAt,
	}, nil
}

func (s *flowService) GetStep(ctx context.Context, req GetFlowStepRequest) (domain.FlowStepResult, error) {
	if req.State == nil {
		return domain.FlowStepResult{}, fmt.Errorf("flow service: get step without state")
	}
	def, err := s.v2Pool.Statements().GetFlowDefinitionByID(ctx, req.State.ProjectID, req.State.DefinitionID)
	if err != nil {
		return domain.FlowStepResult{}, err
	}
	result, err := s.stateMachine.Render(ctx, def, req.State)
	if err != nil {
		return domain.FlowStepResult{}, err
	}
	return domain.FlowStepResult{State: result.State, Step: result.Step}, nil
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
