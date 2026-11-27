package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/flowengine"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/flowdefinition"
)

// FlowService is the flow engine's use-case surface. The API handler
// depends only on this interface.
type FlowService interface {
	// Resolve returns the [domain.FlowDefinition] to run. Direct lookup
	// when Name is set; audience match otherwise.
	Resolve(ctx context.Context, req ResolveFlowRequest) (*domain.FlowDefinition, error)
	// Start mints a fresh flow on the resolved definition.
	Start(ctx context.Context, req StartFlowRequest) (flowengine.StepResult, error)
	// Submit advances the flow; the engine reads the definition the state
	// names.
	Submit(ctx context.Context, req SubmitFlowRequest) (flowengine.StepResult, error)
	// GetStep re-emits the current step without advancing.
	GetStep(ctx context.Context, req GetFlowStepRequest) (flowengine.StepResult, error)
}

type StartFlowRequest struct {
	Definition    *domain.FlowDefinition
	Purpose       domain.FlowDefinitionPurpose
	RedirectURI   *string
	AuthRequestID *string
	SessionID     *string
	UserAgent     *domain.UserAgent
}

type SubmitFlowRequest struct {
	State         *flowengine.State
	Action        string
	Fields        map[string]any
	GateProofs    map[string]string
	SSOProviderID *string
	// SSOReturn is the browser-side context of an external sign-in the API
	// derived from the request. Set on an sso submission.
	SSOReturn *domain.FlowSSOReturn
	// ChallengeResponse carries the client's answer to a pending ceremony
	// (e.g. a passkey assertion). Nil unless the step issued a challenge.
	ChallengeResponse *flowengine.ChallengeResponse
	// PasskeyRP carries the WebAuthn relying-party params derived from the
	// request, needed when issuing a passkey challenge.
	PasskeyRP *flowengine.PasskeyRP
}

type GetFlowStepRequest struct {
	State *flowengine.State
}

type ResolveFlowRequest struct {
	ProjectID     string
	Purpose       domain.FlowDefinitionPurpose
	Name          *string // direct-lookup slug
	SchemaVersion *string // nil = the revision the release pins
	// Hint scopes audience resolution (ignored when Name is set); see
	// [flowengine.EntryByAudience].
	Hint flowengine.EntryHint
}

func NewFlowService(
	v2Pool *DB,
	stateMachine flowengine.StateMachine,
	builtinBases domain.BuiltinSchemaBases,
	protection SignupProtection,
) FlowService {
	return &flowService{
		protection:   protection,
		v2Pool:       v2Pool,
		stateMachine: stateMachine,
		builtinBases: builtinBases,
	}
}

type flowService struct {
	protection   SignupProtection
	v2Pool       *DB
	stateMachine flowengine.StateMachine
	// builtinBases resolves a definition's user schema given as a built-in
	// schema's `$id` under whichever base the project stores it.
	builtinBases domain.BuiltinSchemaBases
}

var _ FlowService = (*flowService)(nil)

// Resolve reads the revisions the request's release pins and lets the flow
// engine choose among them: by name, the one under that handle; by audience,
// all of them.
func (s *flowService) Resolve(ctx context.Context, req ResolveFlowRequest) (_ *domain.FlowDefinition, err error) {
	ctx, end := startSpan(ctx, "FlowService.Resolve")
	defer end(&err)

	pinned, err := runtimePins(ctx, domain.ReleasePointerKindFlowDefinition)
	if err != nil {
		return nil, err
	}
	if len(pinned) == 0 {
		// The release serves no sign-in at all: say that, not that one flow
		// is missing from it.
		return nil, domain.ErrFlowDefinitionNotFound().
			WithMessage("flow definition: the deployed release pins none; deploy a release with a flow")
	}
	criteria := flowengine.EntryCriteria{Purpose: req.Purpose, SchemaVersion: req.SchemaVersion, Hint: req.Hint}
	if req.Name != nil {
		pin, ok := pinned[*req.Name]
		if !ok {
			return nil, domain.ErrFlowDefinitionNotFound()
		}
		def, err := s.v2Pool.Statements().GetFlowDefinitionByID(ctx, req.ProjectID, pin.RevisionID)
		if err != nil {
			if isNoRowFound(err) {
				return nil, domain.ErrFlowDefinitionNotFound()
			}
			return nil, err
		}
		return flowengine.EntryByName(def, criteria)
	}

	revisionIDs := make([]string, 0, len(pinned))
	for _, pin := range pinned {
		revisionIDs = append(revisionIDs, pin.RevisionID)
	}
	result, err := s.v2Pool.Statements().ListFlowDefinitions(WithAuthzListUnrestricted(ctx), &database.ListOptions[domain.FlowDefinitionField]{
		Filter: flowdefinition.ByIDs(req.ProjectID, revisionIDs),
	}, FlowDefinitionQueryOptions{})
	if err != nil {
		return nil, err
	}
	return flowengine.EntryByAudience(result.Items, criteria)
}

// resolveFlowSession returns the id of the session the flow runs against:
// the one the client supplied (a pre-created anonymous session, or an existing
// session for step-up),
// or a freshly persisted anonymous session when none is supplied.
//
// Linking the auth-attempt to this session lets exchange upgrade it in
// place (building -> active) instead of minting a second one.
func (s *flowService) resolveFlowSession(ctx context.Context, req StartFlowRequest) (string, error) {
	if req.SessionID != nil {
		return *req.SessionID, nil
	}
	session, err := domain.NewSession(req.Definition.ProjectID, req.UserAgent)
	if err != nil {
		return "", fmt.Errorf("flow service: create anonymous session: %w", err)
	}
	if err := s.v2Pool.Statements().CreateSession(ctx, session); err != nil {
		return "", fmt.Errorf("flow service: persist anonymous session: %w", err)
	}
	return session.ID, nil
}

func (s *flowService) Start(ctx context.Context, req StartFlowRequest) (res flowengine.StepResult, err error) {
	ctx, end := startSpan(ctx, "FlowService.Start")
	defer end(&err)
	// Where the flow was left, never which step: step names are defined per
	// project. res and err are the named results, so this sees every return.
	defer func() { metrics.RecordFlowTransition(ctx, metrics.FlowStart, flowResult(res, err)) }()

	if req.Definition == nil {
		return flowengine.StepResult{}, fmt.Errorf("flow service: start without definition")
	}
	// A supplied session id must name a real session; reject an empty value up
	// front so it maps to 400 rather than silently producing an unlinked flow.
	if req.SessionID != nil && *req.SessionID == "" {
		return flowengine.StepResult{}, domain.ErrRequestInvalid().WithMessage("session_id must not be empty")
	}

	// The definition names its schema by objectType or id, but the flow and
	// the users it creates are validated against one revision, pinned here at
	// start.
	userSchema, schemaErr := resolveUserSchema(ctx, s.v2Pool.Statements(), s.builtinBases, req.Definition.ProjectID, req.Definition.UserSchema)
	if schemaErr != nil {
		return flowengine.StepResult{}, domain.ErrInternal(schemaErr).WithMessage(
			fmt.Sprintf("failed to resolve user schema %q of flow definition %s", req.Definition.UserSchema, req.Definition.ID))
	}

	sessionID, err := s.resolveFlowSession(ctx, req)
	if err != nil {
		return flowengine.StepResult{}, err
	}

	// Mint and stamp before the state machine so Path B emits during Start
	// (auth.attempt.created) share flow_id / session_id with Path A request.api.
	flowID, err := s.v2Pool.Statements().NewManagedID(string(domain.PrefixFlow))
	if err != nil {
		return flowengine.StepResult{}, fmt.Errorf("flow service: mint flow id: %w", err)
	}
	audit.BindPublicRequest(ctx, req.Definition.ProjectID, flowID, sessionID)
	// The flow is a carrier, and so is the attempt the state machine creates
	// for it: both store the chain this request is in from here on. A flow
	// created for an authorization request is in that request's chain.
	if req.AuthRequestID != nil {
		if err := s.joinAuthRequest(ctx, req.Definition.ProjectID, *req.AuthRequestID); err != nil {
			return flowengine.StepResult{}, err
		}
	}
	correlationID, err := audit.EnsureCorrelation(ctx)
	if err != nil {
		return flowengine.StepResult{}, err
	}

	in := flowengine.StartInput{
		ID:            flowID,
		Definition:    req.Definition,
		Purpose:       req.Purpose,
		Session:       flowengine.SessionRef{ID: sessionID},
		RedirectURI:   req.RedirectURI,
		UserSchemaURL: userSchema.URL,
		CorrelationID: correlationID,
	}
	if req.AuthRequestID != nil {
		in.AuthRequest = &flowengine.AuthRequestRef{ID: *req.AuthRequestID}
	}
	if resolution := RuntimeResolutionFromContext(ctx); resolution != nil {
		if resolution.Deployment != nil {
			in.DeploymentID = resolution.Deployment.ID
		}
		if resolution.Release != nil {
			in.ReleaseID = resolution.Release.ID
		}
	}

	result, err := s.stateMachine.Start(ctx, in)
	if err != nil {
		return flowengine.StepResult{}, err
	}
	return result, nil
}

// joinAuthRequest puts the request into the chain of the authorization
// request a flow is created for. A request the project does not hold starts
// no chain and is not an error here: the flow keeps the ID it was given, as
// before, and whatever redeems it decides.
func (s *flowService) joinAuthRequest(ctx context.Context, projectID, authRequestID string) error {
	request, err := s.v2Pool.Statements().GetAuthRequest(ctx, projectID, authRequestID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil
		}
		return fmt.Errorf("flow service: read auth request: %w", err)
	}
	audit.JoinCorrelation(ctx, request.CorrelationID)
	return nil
}

func (s *flowService) Submit(ctx context.Context, req SubmitFlowRequest) (res flowengine.StepResult, err error) {
	ctx, end := startSpan(ctx, "FlowService.Submit")
	defer end(&err)
	defer func() { metrics.RecordFlowTransition(ctx, metrics.FlowSubmit, flowResult(res, err)) }()

	if req.State == nil {
		return flowengine.StepResult{}, fmt.Errorf("flow service: submit without state")
	}
	defs := flowDefinitions{pool: s.v2Pool, projectID: req.State.ProjectID}
	// todo: gracefully handle when the definition was updated (status, steps, etc.,) since the flow started
	in := flowengine.SubmitInput{
		Action:            req.Action,
		Fields:            req.Fields,
		GateProofs:        req.GateProofs,
		ChallengeResponse: req.ChallengeResponse,
		PasskeyRP:         req.PasskeyRP,
	}
	if req.SSOProviderID != nil {
		in.SSOProvider = &flowengine.SSOProviderRef{ID: *req.SSOProviderID}
	}
	in.SSOReturn = req.SSOReturn
	result, err := s.stateMachine.Process(ctx, defs, req.State, in)
	if err != nil {
		return flowengine.StepResult{}, err
	}
	return result, nil
}

func (s *flowService) GetStep(ctx context.Context, req GetFlowStepRequest) (res flowengine.StepResult, err error) {
	ctx, end := startSpan(ctx, "FlowService.GetStep")
	defer end(&err)
	defer func() { metrics.RecordFlowTransition(ctx, metrics.FlowRender, flowResult(res, err)) }()

	if req.State == nil {
		return flowengine.StepResult{}, fmt.Errorf("flow service: get step without state")
	}
	result, err := s.stateMachine.Render(ctx, flowDefinitions{pool: s.v2Pool, projectID: req.State.ProjectID}, req.State)
	if err != nil {
		return flowengine.StepResult{}, err
	}
	// A render may resolve parked SSO state. Return its updated cookie before
	// attempting issuance, just as Start and Submit do.
	if result.Step != nil && result.Step.SignupRequired && !result.Reseal {
		if s.protection == nil {
			return flowengine.StepResult{}, domain.ErrFlowIntegrity()
		}
		result.Step.SignupChallenge, err = s.protection.Challenge(ctx, result.State)
		if err != nil {
			return flowengine.StepResult{}, err
		}
	}
	return result, nil
}

// flowDefinitions looks up a flow definition by id within the flow's
// project.
type flowDefinitions struct {
	pool      *DB
	projectID string
}

func (d flowDefinitions) Definition(ctx context.Context, id string) (*domain.FlowDefinition, error) {
	return d.pool.Statements().GetFlowDefinitionByID(ctx, d.projectID, id)
}
