package domain

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// FlowStateMachine drives a flow definition forward in response to client
// submissions. It owns the runtime semantics of the definition — applying
// transitions, running on_success hooks, validating field values — and
// produces a [FlowStepResult] the handler turns into the API response.
//
// The handler owns cookie I/O: it decodes the sealed `_zflow` cookie into
// a [FlowState] before calling [FlowStateMachine.Process], and re-encodes
// the returned [FlowState] on the way out. The state machine never
// touches cookies.
//
// MVP scope (per PR 6): a single linear flow per `flow_id`, no pivot
// stack, no challenges, no gates. `Pop` on [FlowStepResult] stays
// reserved for the deferred pivot work — it is always false today.
type FlowStateMachine interface {
	// Start initializes a new flow on top of (possibly empty) prior
	// state and returns the first visible step.
	Start(ctx context.Context, client database.QueryExecutor, in FlowStartInput) (FlowStepResult, error)

	// Process consumes a client submission against the current step and
	// produces the next visible step. The state argument is the decoded
	// cookie payload; the returned [FlowStepResult.State] supersedes
	// it. The handler passes the resolved [FlowDefinition] each call so
	// the state machine does not need to re-fetch it from storage on
	// every submit.
	Process(ctx context.Context, client database.QueryExecutor, def *FlowDefinition, state *FlowState, in FlowSubmitInput) (FlowStepResult, error)

	// Render re-emits the current step without advancing the state
	// machine. Used by the GET /flow/{id} handler to refresh a stale
	// client view after a reload or network error.
	Render(ctx context.Context, client database.QueryExecutor, def *FlowDefinition, state *FlowState) (FlowStepResult, error)
}

// FlowStartInput carries everything the state machine needs to bootstrap
// a new flow: the resolved definition, the purpose, the session it sits
// on top of, and the audience hint used to pick the definition.
//
// UserSchemaURL is the resolved location of the user schema this flow
// validates against. The state machine plumbs it through to
// [FlowFieldResolver]; it is captured here (rather than re-derived per
// step) because the schema is constant for the lifetime of a flow.
//
// RedirectURI is the terminal redirect destination for `complete:
// redirect` flows. It is hoisted out of [FlowAuthRequestRef] so a
// flow can carry a redirect target without being bound to an OIDC
// auth-request (e.g. a standalone register flow whose creator passed
// `redirect_uri` directly).
type FlowStartInput struct {
	Definition    *FlowDefinition
	Purpose       FlowDefinitionPurpose
	Session       FlowSessionRef
	AuthRequest   *FlowAuthRequestRef
	RedirectURI   *string
	Hint          FlowHint
	UserSchemaURL string
}

// FlowSubmitInput carries a single client submission. The state machine
// dispatches on Action against the current step's declared transitions
// and validates Fields against the resolved user schema.
//
// GateProofs and SSOProvider are reserved for future PRs (gates land in
// PR 3, SSO is deferred from MVP); they are accepted today but the
// state machine returns [ErrUnsupported] for any flow that mentions
// them.
//
// ChallengeResponse intentionally absent: it lands when PR 4 wires the
// passkey ceremony.
type FlowSubmitInput struct {
	Action      string
	Fields      map[string]any
	GateProofs  map[string]string
	SSOProvider *FlowSSOProviderRef
}

// FlowSSOProviderRef identifies the provider the user selected on an
// `sso` action. Reserved for the deferred SSO ceremony; MVP returns
// [ErrUnsupported] when this is set.
type FlowSSOProviderRef struct {
	ID string
}

// FlowStepResult is what the state machine returns from [Start] and
// [Process]. The handler seals State back into the cookie and renders
// Step as the response body.
//
// Pop is reserved for the deferred pivot stack: when a child flow
// completes and the parent's progress is restored, Pop is true and Step
// is the parent's next visible step. MVP never sets it.
type FlowStepResult struct {
	State *FlowState
	Step  *FlowStep
	Pop   bool
}

// FlowStep is the capability payload the API surfaces to the client. It
// mirrors the OpenAPI `flow-step` component
// (api/openapi/components/flows/flow-step.yaml) in domain terms; the
// handler maps it to the generated DTO.
//
// MVP omits the components that arrive with later PRs: gates (PR 3),
// challenge (PR 4), branding (handler-level), and step-level texts
// (which the flow definition does not yet carry).
type FlowStep struct {
	// Name is the step name from the flow definition. The client echoes
	// it back on submit so the state machine can confirm the step the
	// submission is targeting.
	Name string

	// Error carries a localization key for a step-level error message
	// raised by the previous submission (e.g. invalid credentials).
	// Per-field validation errors live on FlowField, not here.
	Error *string

	// Complete is set on terminal steps. The client uses it to decide
	// between navigating to RedirectURL ([FlowStepCompleteRedirect]) or
	// rendering a success screen ([FlowStepCompleteShow]).
	Complete *FlowStepComplete

	// RedirectURL is the destination for [FlowStepCompleteRedirect]
	// terminal steps — typically the OIDC callback derived from
	// [FlowAuthRequestRef.RedirectURI].
	RedirectURL *string

	// Fields holds the resolved input capabilities for this step, keyed
	// by property name. Sourced from [FlowFieldResolver.Resolve] over
	// the step's declared fields.
	Fields map[string]FlowField

	// Actions enumerates the actions the user can take on this step,
	// keyed by action name. The keys mirror the outcomes declared on
	// [FlowDefinitionStep.Transitions].
	Actions map[string]FlowAction

	// SSOProviders surfaces the identity providers available on this
	// step. Reserved for the deferred SSO ceremony; MVP always emits an
	// empty slice.
	SSOProviders []FlowSSOProvider
}

// FlowStepComplete classifies a terminal step. Values mirror the
// `complete` enum on the OpenAPI flow-step component.
type FlowStepComplete string

const (
	// FlowStepCompleteRedirect means the client should navigate to
	// [FlowStep.RedirectURL] (the typical OIDC/SAML finish).
	FlowStepCompleteRedirect FlowStepComplete = "redirect"

	// FlowStepCompleteShow means the client should render the step as
	// a success screen (e.g. registration confirmed).
	FlowStepCompleteShow FlowStepComplete = "show"
)

// FlowAction is a single user action surfaced on [FlowStep.Actions].
// The action name is the map key in [FlowStep.Actions], matching the
// outcome key on [FlowDefinitionStep.Transitions].
type FlowAction struct {
	// TextKey is a localization key for the action label, resolved
	// client-side via the `| t` filter. The state machine defaults it
	// to `action.{name}` when the flow definition does not carry an
	// override.
	TextKey string

	// Primary marks the default/primary action on the step. The flow
	// definition does not yet declare it; today only the conventional
	// `submit` outcome is treated as primary.
	Primary bool
}

// FlowActionSubmit is the conventional outcome name for the primary
// "advance forward" action on a step. The state machine flags it as
// primary on the rendered [FlowStep.Actions].
const FlowActionSubmit = "submit"

// FlowSSOProvider is the per-step view of an available identity
// provider. Reserved for the deferred SSO ceremony.
type FlowSSOProvider struct {
	// ID identifies a configured provider instance.
	ID string

	// Name is the display name for the provider.
	Name string

	// Template hints at how the client should render the provider's
	// button (logo, colors).
	Template string
}

// FlowSessionRef pins the session row this flow runs on top of.
// SessionVersion is used by the state machine to detect concurrent
// session mutations (logout from another tab, etc.); a mismatch
// surfaces as [ErrSessionConflict].
type FlowSessionRef struct {
	ID      string
	Version int64
}

// FlowAuthRequestRef ties a flow to the OIDC authorization request it
// is fulfilling. Nil on [FlowStartInput.AuthRequest] for flows started
// outside an OIDC context (standalone registration, recovery). The
// terminal redirect destination lives on [FlowStartInput.RedirectURI]
// directly so the OIDC binding and the redirect URL are independent
// concerns.
type FlowAuthRequestRef struct {
	// ID is the authorization request identifier the OIDC layer
	// minted.
	ID string

	// RequestedACR is the Authentication Context Class Reference asked
	// for by the relying party. Reserved for future risk-policy use;
	// MVP carries it through to [FlowState] but does not act on it.
	RequestedACR *string
}

// FlowHint mirrors the audience information used by [FlowService] to
// pick a definition. The state machine carries it forward so on_success
// handlers and downstream services can scope their work to the same
// audience the definition was selected for.
type FlowHint struct {
	AppID        *string
	TeamID       *string
	UserSchemaID *string
}

// FlowCollectedUserIDKey is the reserved key under which on_success
// handlers stash the resolved user id on [FlowProgress.CollectedData].
// The handler picks it up at terminate time to mint the session token
// / handoff token. Exposed because the handler reads it from the
// sealed cookie payload after the state machine returns.
const FlowCollectedUserIDKey = "_user_id"

// State-machine error sentinels. The handler maps them to the
// appropriate HTTP status; in-flow recoverable failures (validation,
// credential mismatch) are surfaced on [FlowStep.Error] rather than
// returned as errors.
var (
	// ErrInvalidAction is returned when the submitted action is not
	// declared on the current step's transitions.
	ErrInvalidAction = errors.New("flow state machine: action not allowed on current step")

	// ErrSessionConflict is returned when the session version pinned
	// in [FlowState] no longer matches the live session row. The
	// handler maps it to HTTP 409.
	ErrSessionConflict = errors.New("flow state machine: session version conflict")

	// ErrIntegrity is returned for definition/data inconsistencies
	// that should never happen for an activated definition — e.g. a
	// transition targeting a non-existent step. Mapped to HTTP 500.
	ErrIntegrity = errors.New("flow state machine: integrity violation")

	// ErrUnsupported is returned when a submission exercises a feature
	// the MVP engine does not implement (SSO actions, gate proofs,
	// challenge responses). The handler maps it to HTTP 400.
	ErrUnsupported = errors.New("flow state machine: feature not supported in MVP")
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
		RedirectURI:    in.RedirectURI,
	}
	if in.AuthRequest != nil {
		state.AuthRequestID = &in.AuthRequest.ID
		state.RequestedACR = in.AuthRequest.RequestedACR
	}

	step, err := r.renderStep(ctx, client, in.Definition, state, in.UserSchemaURL, nil)
	if err != nil {
		return FlowStepResult{}, err
	}
	return FlowStepResult{State: state, Step: step}, nil
}

// Render re-emits the current step against the supplied definition
// without advancing the state machine. The returned [FlowStepResult.State]
// is the same state value passed in — Render does not refresh
// [FlowState.IssuedAt] because nothing about the flow has changed.
func (r *FlowStateMachineRuntime) Render(ctx context.Context, client database.QueryExecutor, def *FlowDefinition, state *FlowState) (FlowStepResult, error) {
	if def == nil || state == nil {
		return FlowStepResult{}, fmt.Errorf("%w: render without definition or state", ErrIntegrity)
	}
	step, err := r.renderStep(ctx, client, def, state, state.UserSchemaURL, nil)
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
