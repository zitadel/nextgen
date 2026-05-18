package domain

import (
	"context"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// FlowStateMachineRuntime is the production [FlowStateMachine]. It
// composes a [FlowFieldResolver] for per-step schema work and a
// [FlowOnSuccessRegistry] for the side-effect handlers each step can
// declare.
//
// MVP scope: single linear flow, no pivot stack, no gates, no
// challenges. The runtime carries the per-call ordering documented on
// [FlowStateMachine] and stops at the first terminal step it reaches.
type FlowStateMachineRuntime struct {
	fields    FlowFieldResolver
	onSuccess *FlowOnSuccessRegistry
	now       func() time.Time
}

// NewFlowStateMachine wires the runtime. The now hook is injectable
// so tests can produce deterministic [FlowState.IssuedAt] values.
func NewFlowStateMachine(fields FlowFieldResolver, onSuccess *FlowOnSuccessRegistry, now func() time.Time) *FlowStateMachineRuntime {
	if now == nil {
		now = time.Now
	}
	return &FlowStateMachineRuntime{fields: fields, onSuccess: onSuccess, now: now}
}

var _ FlowStateMachine = (*FlowStateMachineRuntime)(nil)

// Start bootstraps a new flow against the supplied definition. It
// builds the initial [FlowState], renders the entry step, and returns
// both for the handler to seal and emit.
func (r *FlowStateMachineRuntime) Start(ctx context.Context, client database.QueryExecutor, in FlowStartInput) (FlowStepResult, error) {
	if in.Definition == nil {
		return FlowStepResult{}, fmt.Errorf("%w: start without definition", ErrIntegrity)
	}
	initialStepName, ok := initialStepFor(in.Definition, in.Purpose)
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
		state.RedirectURI = &in.AuthRequest.RedirectURI
		state.RequestedACR = in.AuthRequest.RequestedACR
	}

	step, err := r.renderStep(ctx, client, in.Definition, state, in.UserSchemaURL, nil)
	if err != nil {
		return FlowStepResult{}, err
	}
	return FlowStepResult{State: state, Step: step}, nil
}

// Process executes one submit against the current step.
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

	currentStep, ok := findStep(def, state.CurrentStep)
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: current step %q missing from definition", ErrIntegrity, state.CurrentStep)
	}

	userSchemaURL := state.UserSchemaURL
	resolved, err := r.resolveStepFields(ctx, client, state.ProjectID, userSchemaURL, currentStep)
	if err != nil {
		return FlowStepResult{}, err
	}

	if validationErr := r.fields.Validate(ctx, client, state.ProjectID, userSchemaURL, in.Fields); validationErr != nil {
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
	if currentStep.OnSuccess != "" {
		handler, err := r.onSuccess.Lookup(currentStep.OnSuccess)
		if err != nil {
			return FlowStepResult{}, fmt.Errorf("%w: %v", ErrIntegrity, err)
		}
		result, err := handler.Handle(ctx, client, FlowOnSuccessInput{
			ProjectID:     state.ProjectID,
			UserSchemaURL: userSchemaURL,
			Fields:        in.Fields,
			Resolved:      resolved,
			State:         state,
			ResolvedFlow:  def,
		})
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
		// Switch / pivot — MVP scope explicitly excludes the pivot stack.
		return FlowStepResult{}, fmt.Errorf("%w: cross-flow transitions", ErrUnsupported)
	}

	nextStep, ok := findStep(def, transition.Target)
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: transition target %q missing from definition", ErrIntegrity, transition.Target)
	}

	r.advance(state, currentStep, nextStep.Name)

	if nextStep.Type == FlowStepTypeComplete {
		step, err := r.terminate(ctx, client, def, state, userSchemaURL, nextStep)
		if err != nil {
			return FlowStepResult{}, err
		}
		return FlowStepResult{State: state, Step: step}, nil
	}

	step, err := r.renderStep(ctx, client, def, state, userSchemaURL, nextStep)
	if err != nil {
		return FlowStepResult{}, err
	}
	return FlowStepResult{State: state, Step: step}, nil
}

// advance is the pure local move: push the previous step onto history,
// move CurrentStep to next, and re-issue the cookie timestamp.
func (r *FlowStateMachineRuntime) advance(state *FlowState, prev *FlowDefinitionStep, nextStepName string) {
	state.History = append(state.History, prev.Name)
	state.CurrentStep = nextStepName
	state.IssuedAt = r.now()
}

// terminate renders the terminal step. It reads the complete kind from
// step.Config["complete"] (defaulting to "show") and threads the
// state's RedirectURL onto the step when the kind is "redirect".
func (r *FlowStateMachineRuntime) terminate(ctx context.Context, client database.QueryExecutor, def *FlowDefinition, state *FlowState, userSchemaURL string, step *FlowDefinitionStep) (*FlowStep, error) {
	kind := readCompleteKind(step.Config)
	rendered, err := r.renderStep(ctx, client, def, state, userSchemaURL, step)
	if err != nil {
		return nil, err
	}
	complete := kind
	rendered.Complete = &complete
	if kind == FlowStepCompleteRedirect && state.RedirectURI != nil {
		uri := *state.RedirectURI
		rendered.RedirectURL = &uri
	}
	return rendered, nil
}

// renderStep produces the [FlowStep] payload for the current step.
// stepOverride is the step to render; nil means "use state.CurrentStep".
// This indirection lets [Start] and [Process] reuse the same render
// helper.
func (r *FlowStateMachineRuntime) renderStep(ctx context.Context, client database.QueryExecutor, def *FlowDefinition, state *FlowState, userSchemaURL string, stepOverride *FlowDefinitionStep) (*FlowStep, error) {
	step := stepOverride
	if step == nil {
		s, ok := findStep(def, state.CurrentStep)
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

// resolveStepFields reads the step's field-name list from its Config
// and asks the [FlowFieldResolver] for the resolved per-field
// metadata. A step without `fields` in its Config resolves to the
// empty catalog (e.g. consent or terminal steps).
func (r *FlowStateMachineRuntime) resolveStepFields(ctx context.Context, client database.QueryExecutor, projectID, userSchemaURL string, step *FlowDefinitionStep) (FlowResolvedFields, error) {
	names := readFieldNames(step.Config)
	if len(names) == 0 {
		return FlowResolvedFields{}, nil
	}
	resolved, err := r.fields.Resolve(ctx, client, projectID, userSchemaURL, names)
	if err != nil {
		return FlowResolvedFields{}, fmt.Errorf("flow state machine: resolve fields on step %q: %w", step.Name, err)
	}
	return resolved, nil
}

// buildStep assembles the [FlowStep] payload from a step's definition
// and its resolved fields. Optional inputs:
//   - errorKey: when non-nil, sets [FlowStep.Error].
//   - complete: when non-nil, sets [FlowStep.Complete].
//   - redirectURL: when non-nil, sets [FlowStep.RedirectURL].
func (r *FlowStateMachineRuntime) buildStep(step *FlowDefinitionStep, resolved FlowResolvedFields, errorKey *string, complete *FlowStepComplete, redirectURL *string) *FlowStep {
	actions := make(map[string]FlowAction, len(step.Transitions))
	for outcome := range step.Transitions {
		actions[outcome] = FlowAction{
			TextKey: "action." + outcome,
			Primary: outcome == FlowActionSubmit,
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

// FlowActionSubmit is the conventional outcome name for the primary
// "advance forward" action on a step. The state machine flags it as
// primary on the rendered [FlowStep.Actions].
const FlowActionSubmit = "submit"

// initialStepFor returns the entry step the definition declares for
// the given purpose, or false if the definition does not serve it.
func initialStepFor(def *FlowDefinition, purpose FlowDefinitionPurpose) (string, bool) {
	for _, p := range def.Purposes {
		if p.Purpose == purpose {
			return p.InitialStep, true
		}
	}
	return "", false
}

// findStep returns a pointer into def.Steps for the step named name,
// or false if no such step exists.
func findStep(def *FlowDefinition, name string) (*FlowDefinitionStep, bool) {
	for i := range def.Steps {
		if def.Steps[i].Name == name {
			return &def.Steps[i], true
		}
	}
	return nil, false
}

// readFieldNames extracts the `fields` list from a step's Config. The
// list is encoded as `[]any` of strings on the JSON side; the
// repository decodes it through `json.Unmarshal` into the same shape.
func readFieldNames(config map[string]any) []string {
	raw, ok := config["fields"]
	if !ok {
		return nil
	}
	values, ok := raw.([]any)
	if !ok {
		return nil
	}
	names := make([]string, 0, len(values))
	for _, v := range values {
		if s, ok := v.(string); ok {
			names = append(names, s)
		}
	}
	return names
}

// readCompleteKind reads the terminal step's `complete` Config entry.
// Defaults to [FlowStepCompleteShow] when the entry is missing or
// invalid — a terminal step without a redirect destination is a
// success screen.
func readCompleteKind(config map[string]any) FlowStepComplete {
	raw, ok := config["complete"]
	if !ok {
		return FlowStepCompleteShow
	}
	s, ok := raw.(string)
	if !ok {
		return FlowStepCompleteShow
	}
	if s == string(FlowStepCompleteRedirect) {
		return FlowStepCompleteRedirect
	}
	return FlowStepCompleteShow
}

// FlowCollectedUserIDKey is the reserved key under which on_success
// handlers stash the resolved user id on [FlowProgress.CollectedData].
// The handler picks it up at terminate time to mint the session token
// / handoff token. Exposed because the handler reads it from the
// sealed cookie payload after the state machine returns.
const FlowCollectedUserIDKey = "_user_id"

// recordResolvedUser stores the user id surfaced by an on_success
// handler under the reserved key.
func recordResolvedUser(state *FlowState, userID string) {
	if state.CollectedData == nil {
		state.CollectedData = map[string]any{}
	}
	state.CollectedData[FlowCollectedUserIDKey] = userID
}

// mergeCollected copies the submitted field values onto the state's
// collected data map, creating the map if needed. Subsequent
// submissions overwrite earlier values for the same key — matching the
// "last write wins" expectation when a user re-submits a step.
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

// asValidationErrors unwraps err into a [FlowFieldValidationErrors] if
// the underlying type matches, mirroring `errors.As` ergonomics
// without forcing handlers to import the errors package just for this
// one check.
func asValidationErrors(err error, out *FlowFieldValidationErrors) bool {
	if errs, ok := err.(FlowFieldValidationErrors); ok {
		*out = errs
		return true
	}
	return false
}
