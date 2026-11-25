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
	// Submit advances the state machine. Re-fetches the definition
	// from flowengine.State.DefinitionID.
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
	AuthRequestID *string
	// Hint scopes audience resolution (ignored when Name is set); see
	// [flowengine.EntryByAudience].
	Hint ResolveFlowHint
}

type ResolveFlowHint = flowengine.EntryHint

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

	in := flowengine.StartInput{
		ID:            flowID,
		Definition:    req.Definition,
		Purpose:       req.Purpose,
		Session:       flowengine.SessionRef{ID: sessionID},
		RedirectURI:   req.RedirectURI,
		UserSchemaURL: userSchema.URL,
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
	if err := s.attachSignupGate(ctx, s.flowDefinitions(req.Definition.ProjectID, req.Definition), &result); err != nil {
		return flowengine.StepResult{}, err
	}
	return flowengine.StepResult{State: result.State, Step: result.Step}, nil
}

func (s *flowService) Submit(ctx context.Context, req SubmitFlowRequest) (res flowengine.StepResult, err error) {
	ctx, end := startSpan(ctx, "FlowService.Submit")
	defer end(&err)
	defer func() { metrics.RecordFlowTransition(ctx, metrics.FlowSubmit, flowResult(res, err)) }()

	if req.State == nil {
		return flowengine.StepResult{}, fmt.Errorf("flow service: submit without state")
	}
	defs := s.flowDefinitions(req.State.ProjectID)
	// todo: gracefully handle when the definition was updated (status, steps, etc.,) since the flow started
	// Loaded before the attempt is read; Process reads the loaded one.
	if _, err := flowengine.ActiveDefinition(ctx, defs, req.State); err != nil {
		return flowengine.StepResult{}, err
	}
	// A dead attempt fails every submission that reaches it, so the flow
	// restarts here, as a render does. A handoff racing this read still ends
	// in att.already_handed_off.
	attempt, err := s.v2Pool.Statements().GetAuthAttemptByID(ctx, req.State.ProjectID, req.State.AuthAttemptID)
	if err != nil {
		return flowengine.StepResult{}, fmt.Errorf("flow service: read auth attempt: %w", err)
	}
	if attempt.IsExpired() || attempt.IsHandedOff() {
		return flowengine.StepResult{}, domain.ErrFlowRestartRequired()
	}
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
	if err := s.attachSignupGate(ctx, defs, &result); err != nil {
		return flowengine.StepResult{}, err
	}
	return flowengine.StepResult{
		State:                 result.State,
		Step:                  result.Step,
		HandoffToken:          result.HandoffToken,
		HandoffTokenExpiresAt: result.HandoffTokenExpiresAt,
		SSOBindingNonce:       result.SSOBindingNonce,
	}, nil
}

func (s *flowService) GetStep(ctx context.Context, req GetFlowStepRequest) (res flowengine.StepResult, err error) {
	ctx, end := startSpan(ctx, "FlowService.GetStep")
	defer end(&err)
	defer func() { metrics.RecordFlowTransition(ctx, metrics.FlowRender, flowResult(res, err)) }()

	if req.State == nil {
		return flowengine.StepResult{}, fmt.Errorf("flow service: get step without state")
	}
	defs := s.flowDefinitions(req.State.ProjectID)
	result, err := s.stateMachine.Render(ctx, defs, req.State)
	if err != nil {
		return flowengine.StepResult{}, err
	}
	if err := s.attachSignupGate(ctx, defs, &result); err != nil {
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
	return flowengine.StepResult{
		State:                 result.State,
		Step:                  result.Step,
		HandoffToken:          result.HandoffToken,
		HandoffTokenExpiresAt: result.HandoffTokenExpiresAt,
		Reseal:                result.Reseal,
	}, nil
}

// flowDefinitions loads one request's flow definitions by revision id and
// keeps each it loaded, so the engine and the sign-up gate share one read.
// A flow's state names a revision the release it started under pins, and
// every later request runs under that sealed release.
type flowDefinitions struct {
	pool      *DB
	projectID string
	loaded    map[string]*domain.FlowDefinition
}

// flowDefinitions starts the request's definitions with those already loaded.
func (s *flowService) flowDefinitions(projectID string, loaded ...*domain.FlowDefinition) *flowDefinitions {
	defs := &flowDefinitions{pool: s.v2Pool, projectID: projectID, loaded: map[string]*domain.FlowDefinition{}}
	for _, def := range loaded {
		defs.loaded[def.ID] = def
	}
	return defs
}

func (d *flowDefinitions) Definition(ctx context.Context, id string) (*domain.FlowDefinition, error) {
	if def, ok := d.loaded[id]; ok {
		return def, nil
	}
	def, err := d.pool.Statements().GetFlowDefinitionByID(ctx, d.projectID, id)
	if err != nil {
		return nil, err
	}
	d.loaded[id] = def
	return def, nil
}

// attachSignupGate announces the sign-up gate on a step whose next submit
// spends the sign-up proof: one whose on_success declares it, or one carrying a
// passkey registration that creates its user. Runtime enforcement does not
// depend on template markup or client-selected purpose. The step is looked up
// in the definition of the flow active in result.State.
func (s *flowService) attachSignupGate(ctx context.Context, defs flowengine.Definitions, result *flowengine.StepResult) error {
	if result.Step == nil || result.State == nil {
		return nil
	}
	def, err := flowengine.ActiveDefinition(ctx, defs, result.State)
	if err != nil {
		return err
	}
	step, ok := def.FindStep(result.Step.Name)
	if ok && step.OnSuccessSpec().SpendsSignupProof {
		result.Step.SignupRequired = true
		return nil
	}
	creates, err := s.registrationCreatesUser(ctx, result)
	if err != nil {
		return err
	}
	result.Step.SignupRequired = creates
	return nil
}

// registrationCreatesUser reports whether the step carries a passkey
// registration that creates its user, which its attestation spends the
// sign-up proof for. The attempt's stored challenge decides, as it does at
// verification: the ceremony is provisional when no user was pinned at issue.
func (s *flowService) registrationCreatesUser(ctx context.Context, result *flowengine.StepResult) (bool, error) {
	challenge := result.Step.Challenge
	if challenge == nil || challenge.Method != flowengine.ChallengeMethodPasskeyRegister {
		return false, nil
	}
	attempt, err := s.v2Pool.Statements().GetAuthAttemptByID(ctx, result.State.ProjectID, result.State.AuthAttemptID)
	if errors.Is(err, domain.ErrAuthAttemptNotFound()) {
		// Nothing to gate: the attestation is refused with the attempt.
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("flow service: read auth attempt: %w", err)
	}
	stored, ok := attempt.ChallengeByID(challenge.ChallengeID)
	if !ok {
		// A superseded ceremony fails as stale when its attestation arrives.
		return false, nil
	}
	registration, ok := stored.(*domain.AuthChallengePasskeyRegistration)
	return ok && registration.Provisional, nil
}
