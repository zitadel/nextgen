package domain

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// FlowStateMachine drives a flow definition forward in response to
// client submissions. The handler owns cookie I/O; the state machine
// never touches cookies.
//
// MVP scope: single linear flow per `flow_id`, no pivot stack, no
// challenges, no gates. `Pop` on [FlowStepResult] stays reserved for
// the deferred pivot work.
type FlowStateMachine interface {
	Start(ctx context.Context, client database.QueryExecutor, in FlowStartInput) (FlowStepResult, error)
	Process(ctx context.Context, client database.QueryExecutor, def *FlowDefinition, state *FlowState, in FlowSubmitInput) (FlowStepResult, error)
	// Render re-emits the current step without advancing. Backs GET /flow/{id}.
	Render(ctx context.Context, client database.QueryExecutor, def *FlowDefinition, state *FlowState) (FlowStepResult, error)
}

// FlowStartInput carries everything the state machine needs to
// bootstrap a new flow.
type FlowStartInput struct {
	Definition    *FlowDefinition
	Purpose       FlowDefinitionPurpose
	Session       FlowSessionRef
	AuthRequest   *FlowAuthRequestRef
	RedirectURI   *string
	UserSchemaURL string
}

// FlowSubmitInput carries a single client submission.
//
// GateProofs and SSOProvider are reserved; the state machine returns
// [ErrUnsupported] for any flow that exercises them today.
type FlowSubmitInput struct {
	Action      string
	Fields      map[string]any
	GateProofs  map[string]string
	SSOProvider *FlowSSOProviderRef
}

type FlowSSOProviderRef struct {
	ID string
}

// FlowStepResult is what the state machine returns from [Start] and
// [Process]. Pop is reserved for the deferred pivot stack. HandoffToken
// + HandoffTokenExpiresAt are populated only on the terminal step.
type FlowStepResult struct {
	State                 *FlowState
	Step                  *FlowStep
	Pop                   bool
	HandoffToken          string
	HandoffTokenExpiresAt time.Time
}

// FlowStep is the capability payload the API surfaces to the client.
// It mirrors the OpenAPI `flow-step` component in domain terms.
type FlowStep struct {
	Name         string
	Error        *string
	Complete     *FlowStepComplete
	RedirectURL  *string
	Fields       map[string]FlowField
	Actions      map[string]FlowAction
	SSOProviders []FlowSSOProvider
}

// FlowAction is a single user action surfaced on [FlowStep.Actions].
type FlowAction struct {
	TextKey string
	Primary bool
}

// FlowActionSubmit is the conventional outcome name for the primary
// "advance forward" action on a step.
const FlowActionSubmit = "submit"

// FlowSessionRef pins the session row this flow runs on top of. A
// version mismatch surfaces as [ErrSessionConflict].
type FlowSessionRef struct {
	ID      string
	Version int64
}

// FlowAuthRequestRef ties a flow to the OIDC authorization request it
// is fulfilling.
type FlowAuthRequestRef struct {
	ID           string
	RequestedACR *string
}

// FlowCollectedUserIDKey is the reserved key under which on_success
// handlers stash the resolved user id on [FlowProgress.CollectedData].
const FlowCollectedUserIDKey = "_user_id"

var (
	ErrInvalidAction   = errors.New("flow state machine: action not allowed on current step")
	ErrSessionConflict = errors.New("flow state machine: session version conflict")
	ErrIntegrity       = errors.New("flow state machine: integrity violation")
	ErrUnsupported     = errors.New("flow state machine: feature not supported in MVP")
)

// FlowStateMachineRuntime is the production [FlowStateMachine].
type FlowStateMachineRuntime struct {
	fields       FlowFieldResolver
	createUser   *FlowCreateUserHandler
	authAttempts FlowAuthAttemptService
	now          func() time.Time
}

// NewFlowStateMachine wires the runtime. The now hook is injectable so
// tests can produce deterministic [FlowState.IssuedAt] values.
func NewFlowStateMachine(fields FlowFieldResolver, createUser *FlowCreateUserHandler, authAttempts FlowAuthAttemptService, now func() time.Time) *FlowStateMachineRuntime {
	if now == nil {
		now = time.Now
	}
	return &FlowStateMachineRuntime{fields: fields, createUser: createUser, authAttempts: authAttempts, now: now}
}

var _ FlowStateMachine = (*FlowStateMachineRuntime)(nil)

func (r *FlowStateMachineRuntime) Start(ctx context.Context, client database.QueryExecutor, in FlowStartInput) (FlowStepResult, error) {
	if in.Definition == nil {
		return FlowStepResult{}, fmt.Errorf("%w: start without definition", ErrIntegrity)
	}
	initialStepName, ok := in.Definition.InitialStepFor(in.Purpose)
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: definition %q does not serve purpose %s", ErrIntegrity, in.Definition.ID, in.Purpose)
	}

	state := &FlowState{
		ProjectID:     in.Definition.ProjectID,
		UserSchemaURL: in.UserSchemaURL,
		FlowProgress: FlowProgress{
			DefinitionID:  in.Definition.ID,
			Purpose:       in.Purpose,
			CurrentStep:   initialStepName,
			History:       nil,
			CollectedData: map[string]any{},
		},
		IssuedAt:       r.now(),
		SessionID:      in.Session.ID,
		SessionVersion: in.Session.Version,
	}
	if in.AuthRequest != nil {
		state.AuthRequestID = &in.AuthRequest.ID
		state.RequestedACR = in.AuthRequest.RequestedACR
	}
	if in.RedirectURI != nil {
		uri := *in.RedirectURI
		state.RedirectURI = &uri
	}

	if r.authAttempts == nil {
		return FlowStepResult{}, fmt.Errorf("%w: auth-attempt service not wired", ErrIntegrity)
	}
	attemptID, err := r.authAttempts.Start(ctx, FlowCreateAttemptInput{ProjectID: state.ProjectID})
	if err != nil {
		return FlowStepResult{}, fmt.Errorf("flow state machine: start auth attempt: %w", err)
	}
	state.AuthAttemptID = attemptID

	step, err := r.renderStep(ctx, client, in.Definition, state, in.UserSchemaURL, nil)
	if err != nil {
		return FlowStepResult{}, err
	}
	return FlowStepResult{State: state, Step: step}, nil
}

// Render re-emits the current step without advancing. Refreshes IssuedAt
// so the cookie max-age window slides while the user is on the step.
func (r *FlowStateMachineRuntime) Render(ctx context.Context, client database.QueryExecutor, def *FlowDefinition, state *FlowState) (FlowStepResult, error) {
	if def == nil || state == nil {
		return FlowStepResult{}, fmt.Errorf("%w: render without definition or state", ErrIntegrity)
	}
	step, err := r.renderStep(ctx, client, def, state, state.UserSchemaURL, nil)
	if err != nil {
		return FlowStepResult{}, err
	}
	state.IssuedAt = r.now()
	return FlowStepResult{State: state, Step: step}, nil
}

func (r *FlowStateMachineRuntime) Process(ctx context.Context, client database.QueryExecutor, def *FlowDefinition, state *FlowState, in FlowSubmitInput) (FlowStepResult, error) {
	if def == nil || state == nil {
		return FlowStepResult{}, fmt.Errorf("%w: process without definition or state", ErrIntegrity)
	}
	if in.SSOProvider != nil {
		return FlowStepResult{}, fmt.Errorf("%w: sso submissions", ErrUnsupported)
	}
	if len(in.GateProofs) > 0 {
		return FlowStepResult{}, fmt.Errorf("%w: gate proofs", ErrUnsupported)
	}

	currentStep, ok := def.FindStep(state.CurrentStep)
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: current step %q missing from definition", ErrIntegrity, state.CurrentStep)
	}

	userSchemaURL := state.UserSchemaURL
	resolved, err := r.resolveStepFields(ctx, client, state.ProjectID, userSchemaURL, currentStep)
	if err != nil {
		return FlowStepResult{}, err
	}

	if validationErr := r.fields.Validate(resolved, in.Fields); validationErr != nil {
		var errs FlowFieldValidationErrors
		if asValidationErrors(validationErr, &errs) {
			msg := errs.Error()
			step := r.buildStep(currentStep, resolved, &msg, nil, nil)
			state.IssuedAt = r.now()
			return FlowStepResult{State: state, Step: step}, nil
		}
		return FlowStepResult{}, fmt.Errorf("flow state machine: validate fields: %w", validationErr)
	}

	mergeCollected(state, in.Fields)

	routeOutcome := in.Action
	dispatch, err := r.dispatchChallenges(ctx, state, currentStep, resolved, in.Fields)
	if err != nil {
		return FlowStepResult{}, err
	}
	if dispatch.StepError != nil {
		step := r.buildStep(currentStep, resolved, dispatch.StepError, nil, nil)
		state.IssuedAt = r.now()
		return FlowStepResult{State: state, Step: step}, nil
	}
	if dispatch.Outcome != "" {
		routeOutcome = dispatch.Outcome
	} else if currentStep.OnSuccess != nil {
		result, err := r.runOnSuccess(ctx, client, def, state, userSchemaURL, currentStep, in.Fields, resolved)
		if err != nil {
			return FlowStepResult{}, err
		}
		if result.UserID != "" {
			recordResolvedUser(state, result.UserID)
		}
		if result.StepError != nil {
			step := r.buildStep(currentStep, resolved, result.StepError, nil, nil)
			state.IssuedAt = r.now()
			return FlowStepResult{State: state, Step: step}, nil
		}
		if result.Outcome != "" {
			routeOutcome = result.Outcome
		}
	}

	transition, ok := currentStep.Transitions[routeOutcome]
	if !ok {
		// Unknown outcome from a handler degrades to a step error; an
		// unknown user-supplied action is a protocol-level mistake.
		if routeOutcome != in.Action {
			msg := routeOutcome
			step := r.buildStep(currentStep, resolved, &msg, nil, nil)
			state.IssuedAt = r.now()
			return FlowStepResult{State: state, Step: step}, nil
		}
		return FlowStepResult{}, fmt.Errorf("%w: %q on step %q", ErrInvalidAction, in.Action, currentStep.Name)
	}
	if transition.Action != nil {
		return FlowStepResult{}, fmt.Errorf("%w: cross-flow transitions", ErrUnsupported)
	}

	nextStep, ok := def.FindStep(transition.Target)
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: transition target %q missing from definition", ErrIntegrity, transition.Target)
	}

	r.advance(state, currentStep, nextStep.Name)

	if nextStep.Complete != nil {
		step, handoff, err := r.terminate(ctx, client, def, state, userSchemaURL, nextStep)
		if err != nil {
			return FlowStepResult{}, err
		}
		return FlowStepResult{
			State:                 state,
			Step:                  step,
			HandoffToken:          handoff.Token,
			HandoffTokenExpiresAt: handoff.ExpiresAt,
		}, nil
	}

	step, err := r.renderStep(ctx, client, def, state, userSchemaURL, nextStep)
	if err != nil {
		return FlowStepResult{}, err
	}
	return FlowStepResult{State: state, Step: step}, nil
}

// flowDispatchResult summarizes the challenge dispatch loop. Outcome
// diverts routing (e.g. user_not_found); StepError holds the user on
// the current step (e.g. password rejected). At most one is set.
type flowDispatchResult struct {
	Outcome   string
	StepError *string
}

// challengeDispatchOrder pins the order in which field-shaped
// challenges are submitted. Identifier precedes Password because the
// auth-attempt domain requires the user to be identified first.
var challengeDispatchOrder = []FlowFieldChallenge{
	FlowFieldChallengeIdentifier,
	FlowFieldChallengePassword,
}

// dispatchChallenges submits each field-shaped challenge in
// [challengeDispatchOrder]. Steps with on_success=create_user skip
// dispatch entirely: create_user owns identifier uniqueness and
// password setting; routing them through auth-attempt would double up.
func (r *FlowStateMachineRuntime) dispatchChallenges(ctx context.Context, state *FlowState, step *FlowDefinitionStep, resolved FlowResolvedFields, fields map[string]any) (flowDispatchResult, error) {
	if step.OnSuccess != nil && *step.OnSuccess == FlowOnSuccessCreateUser {
		return flowDispatchResult{}, nil
	}

	for _, challenge := range challengeDispatchOrder {
		name, value, ok := fieldValueByChallenge(resolved, fields, challenge)
		if !ok {
			continue
		}
		switch challenge {
		case FlowFieldChallengeIdentifier:
			userID, err := r.authAttempts.SubmitIdentifier(ctx, FlowSubmitIdentifierInput{
				ProjectID:     state.ProjectID,
				AttemptID:     state.AuthAttemptID,
				AttributeName: name,
				Value:         value,
			})
			if errors.Is(err, ErrAuthAttemptProofRejected(nil)) {
				return flowDispatchResult{Outcome: FlowImplicitOutcomeUserNotFound}, nil
			}
			if err != nil {
				return flowDispatchResult{}, fmt.Errorf("flow state machine: submit identifier: %w", err)
			}
			recordResolvedUser(state, userID)
		case FlowFieldChallengePassword:
			err := r.authAttempts.SubmitPassword(ctx, FlowSubmitPasswordInput{
				ProjectID: state.ProjectID,
				AttemptID: state.AuthAttemptID,
				Plain:     value,
			})
			if errors.Is(err, ErrAuthAttemptProofRejected(nil)) {
				msg := "auth_attempt.password_invalid"
				return flowDispatchResult{StepError: &msg}, nil
			}
			if err != nil {
				return flowDispatchResult{}, fmt.Errorf("flow state machine: submit password: %w", err)
			}
		}
	}
	return flowDispatchResult{}, nil
}

func fieldValueByChallenge(resolved FlowResolvedFields, fields map[string]any, target FlowFieldChallenge) (name, value string, ok bool) {
	for n, field := range resolved.Fields {
		if field.Challenge != target {
			continue
		}
		raw, present := fields[n]
		if !present {
			continue
		}
		s, _ := raw.(string)
		return n, s, true
	}
	return "", "", false
}

// runOnSuccess dispatches the step's on_success mutation. Add a case
// when a new [FlowOnSuccess] handler lands.
func (r *FlowStateMachineRuntime) runOnSuccess(ctx context.Context, client database.QueryExecutor, def *FlowDefinition, state *FlowState, userSchemaURL string, step *FlowDefinitionStep, fields map[string]any, resolved FlowResolvedFields) (FlowOnSuccessResult, error) {
	in := FlowOnSuccessInput{
		ProjectID:     state.ProjectID,
		UserSchemaURL: userSchemaURL,
		Fields:        fields,
		Resolved:      resolved,
		State:         state,
		ResolvedFlow:  def,
	}
	switch *step.OnSuccess {
	case FlowOnSuccessCreateUser:
		if r.createUser == nil {
			return FlowOnSuccessResult{}, fmt.Errorf("%w: create_user handler not wired", ErrIntegrity)
		}
		return r.createUser.Handle(ctx, client, in)
	default:
		return FlowOnSuccessResult{}, fmt.Errorf("%w: unknown on_success %s", ErrIntegrity, *step.OnSuccess)
	}
}

func (r *FlowStateMachineRuntime) advance(state *FlowState, prev *FlowDefinitionStep, nextStepName string) {
	state.History = append(state.History, prev.Name)
	state.CurrentStep = nextStepName
	state.IssuedAt = r.now()
}

func (r *FlowStateMachineRuntime) terminate(ctx context.Context, client database.QueryExecutor, def *FlowDefinition, state *FlowState, userSchemaURL string, step *FlowDefinitionStep) (*FlowStep, FlowHandoffOutput, error) {
	rendered, err := r.renderStep(ctx, client, def, state, userSchemaURL, step)
	if err != nil {
		return nil, FlowHandoffOutput{}, err
	}
	kind := *step.Complete
	rendered.Complete = &kind
	if kind == FlowStepCompleteRedirect && state.RedirectURI != nil {
		uri := *state.RedirectURI
		rendered.RedirectURL = &uri
	}

	if state.AuthAttemptID == "" {
		return nil, FlowHandoffOutput{}, fmt.Errorf("%w: terminate without auth attempt id", ErrIntegrity)
	}
	handoff, err := r.authAttempts.Handoff(ctx, FlowHandoffInput{
		ProjectID: state.ProjectID,
		AttemptID: state.AuthAttemptID,
	})
	if err != nil {
		return nil, FlowHandoffOutput{}, fmt.Errorf("flow state machine: handoff: %w", err)
	}
	return rendered, handoff, nil
}

func (r *FlowStateMachineRuntime) renderStep(ctx context.Context, client database.QueryExecutor, def *FlowDefinition, state *FlowState, userSchemaURL string, stepOverride *FlowDefinitionStep) (*FlowStep, error) {
	step := stepOverride
	if step == nil {
		s, ok := def.FindStep(state.CurrentStep)
		if !ok {
			return nil, fmt.Errorf("%w: render unknown step %q", ErrIntegrity, state.CurrentStep)
		}
		step = s
	}
	resolved, err := r.resolveStepFields(ctx, client, state.ProjectID, userSchemaURL, step)
	if err != nil {
		return nil, err
	}
	return r.buildStep(step, resolved, nil, nil, nil), nil
}

func (r *FlowStateMachineRuntime) resolveStepFields(ctx context.Context, client database.QueryExecutor, projectID, userSchemaURL string, step *FlowDefinitionStep) (FlowResolvedFields, error) {
	if len(step.Fields) == 0 {
		return FlowResolvedFields{}, nil
	}
	resolved, err := r.fields.Resolve(ctx, client, projectID, userSchemaURL, step.Fields)
	if err != nil {
		return FlowResolvedFields{}, fmt.Errorf("flow state machine: resolve fields on step %q: %w", step.Name, err)
	}
	return resolved, nil
}

func (r *FlowStateMachineRuntime) buildStep(step *FlowDefinitionStep, resolved FlowResolvedFields, errorKey *string, complete *FlowStepComplete, redirectURL *string) *FlowStep {
	// Surface only user-selectable actions declared on the step.
	// Implicit outcomes (e.g. user_not_found) live in step.Transitions
	// but are engine-emitted routing keys, not buttons for the client.
	actions := make(map[string]FlowAction, len(step.Actions))
	for name, a := range step.Actions {
		textKey := a.TextKey
		if textKey == "" {
			textKey = "action." + name
		}
		actions[name] = FlowAction{
			TextKey: textKey,
			Primary: a.Primary,
		}
	}
	return &FlowStep{
		Name:         step.Name,
		Error:        errorKey,
		Complete:     complete,
		RedirectURL:  redirectURL,
		Fields:       resolved.Fields,
		Actions:      actions,
		SSOProviders: nil,
	}
}

func recordResolvedUser(state *FlowState, userID string) {
	if state.CollectedData == nil {
		state.CollectedData = map[string]any{}
	}
	state.CollectedData[FlowCollectedUserIDKey] = userID
}

func mergeCollected(state *FlowState, fields map[string]any) {
	if len(fields) == 0 {
		return
	}
	if state.CollectedData == nil {
		state.CollectedData = map[string]any{}
	}
	for k, v := range fields {
		state.CollectedData[k] = v
	}
}

func asValidationErrors(err error, out *FlowFieldValidationErrors) bool {
	if errs, ok := err.(FlowFieldValidationErrors); ok {
		*out = errs
		return true
	}
	return false
}
