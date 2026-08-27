package domain

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/maputil"
)

// Step error text keys the state machine emits when an auth-attempt
// proof is rejected. Every engine-emitted step error must be a
// localizable `error.*` catalog key or a reserved outcome token:
// /login localizes only `error.*`-prefixed step errors and treats
// outcome tokens as routing, so anything else renders verbatim (see
// `localiseFlowErrorKeys` in
// packages/components/src/orchestrator/liquid.ts). New emission sites
// add a const here; [FlowStepErrorAllowed] and its contract test keep
// the set honest.
const (
	// FlowStepErrorInvalidCredentials reports a rejected password
	// proof. The client routes it inline to the password field
	// (fieldErrorKeys in liquid.ts).
	FlowStepErrorInvalidCredentials = "error.invalid_credentials"
	// FlowStepErrorPasskeyInvalid reports a rejected passkey assertion.
	FlowStepErrorPasskeyInvalid = "error.passkey_invalid"
	// FlowStepErrorPasskeyRegistrationInvalid reports a rejected
	// passkey registration attestation.
	FlowStepErrorPasskeyRegistrationInvalid = "error.passkey_registration_invalid"
)

// FlowStepErrorAllowed reports whether a step error value honors the
// client contract: a localizable `error.*` text key or a reserved
// outcome token (reservedOutcomes in flow_definition_validator.go).
func FlowStepErrorAllowed(key string) bool {
	if strings.HasPrefix(key, "error.") {
		return true
	}
	_, ok := reservedOutcomes[key]
	return ok
}

// FlowStateMachine drives a flow definition forward in response to
// client submissions. The handler owns cookie I/O; the state machine
// never touches cookies.
//
// MVP scope: single linear flow per `flow_id`, no pivot stack, no
// challenges, no gates. `Pop` on [FlowStepResult] stays reserved for
// the deferred pivot work.
type FlowStateMachine interface {
	Start(ctx context.Context, in FlowStartInput) (FlowStepResult, error)
	Process(ctx context.Context, def *FlowDefinition, state *FlowState, in FlowSubmitInput) (FlowStepResult, error)
	// Render re-emits the current step without advancing. Backs GET /flow/{id}.
	Render(ctx context.Context, def *FlowDefinition, state *FlowState) (FlowStepResult, error)
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
// [ErrFlowUnsupported] for any flow that exercises them today.
type FlowSubmitInput struct {
	Action      string
	Fields      map[string]any
	GateProofs  map[string]string
	SSOProvider *FlowSSOProviderRef
	// ChallengeResponse carries the client's answer to a pending ceremony
	// (e.g. a passkey assertion). Present on the verify leg of a two-phase
	// challenge; nil otherwise.
	ChallengeResponse *FlowChallengeResponse
	// PasskeyRP carries the WebAuthn relying-party parameters the API
	// derived from the request. Required on the passkey issue leg.
	PasskeyRP *FlowPasskeyRP
}

// FlowChallengeResponse is the client's answer to a [FlowPendingChallenge].
type FlowChallengeResponse struct {
	ChallengeID string
	Method      string
	// Proof is the method-specific payload (for passkey, the WebAuthn
	// PublicKeyCredential assertion JSON).
	Proof []byte
}

// FlowPasskeyRP is the relying-party context for issuing a passkey
// challenge, derived from the HTTP request at the API edge.
type FlowPasskeyRP struct {
	RPID    string
	Origins []string
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
	Texts        FlowStepTexts
	Error        *string
	Complete     *FlowStepComplete
	RedirectURL  *string
	Fields       []FlowField
	Actions      []FlowAction
	SSOProviders []FlowSSOProvider
	// Challenge is a pending authentication ceremony the client must
	// satisfy before re-submitting (e.g. a passkey assertion). Nil unless
	// the engine just issued one.
	Challenge *FlowStepChallenge
}

// FlowStepChallenge mirrors the OpenAPI `flow-step.challenge`: a pending
// ceremony the client runs (passkey today) before re-submitting the proof.
type FlowStepChallenge struct {
	Method      string
	ChallengeID string
	// Options is the protocol-specific options JSON the client passes to
	// the ceremony API (for passkey, PublicKeyCredentialRequestOptions).
	Options []byte
}

// FlowStepTexts holds the step-level localization keys (`<step>.title`,
// `<step>.description`) the template resolves via the `| t` filter.
type FlowStepTexts struct {
	TitleKey       string
	DescriptionKey string
}

// FlowAction is a single user action surfaced on [FlowStep.Actions].
type FlowAction struct {
	Name    string
	Kind    FlowActionKind
	TextKey string
	Primary bool
}

// FlowActionSubmit is the conventional outcome name for the primary
// "advance forward" action on a step.
const FlowActionSubmit = "submit"

// FlowActionPasskey is the action a step declares to offer passkey
// authentication. Selecting it issues a WebAuthn challenge; the matching
// transition fires once the returned assertion verifies.
const FlowActionPasskey = "passkey"

// FlowActionPasskeyRegister is the action a step declares to offer passkey
// enrollment. Selecting it issues a registration challenge; the matching
// transition fires once the returned attestation verifies.
const FlowActionPasskeyRegister = "passkey_register"

// flowBackActionName is the name attached to the injected back action.
const flowBackActionName = "back"

// FlowChallengeMethodPasskey is the [FlowStepChallenge.Method] /
// [FlowPendingChallenge.Method] value for the WebAuthn passkey ceremony.
const FlowChallengeMethodPasskey = "passkey"

// FlowChallengeMethodPasskeyRegister is the [FlowStepChallenge.Method] /
// [FlowPendingChallenge.Method] value for the WebAuthn registration ceremony.
const FlowChallengeMethodPasskeyRegister = "passkey_register"

// flowPasskeyDefaultUserVerification is the WebAuthn user-verification
// requirement used when issuing a passkey challenge from a flow. The RP
// origin/id come from the request; user verification is defaulted.
const flowPasskeyDefaultUserVerification = "preferred"

// FlowSessionRef pins the session row this flow runs on top of. A
// version mismatch surfaces as [ErrFlowSessionConflict].
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

// FlowStateMachineRuntime is the production [FlowStateMachine].
type FlowStateMachineRuntime struct {
	schemas      SchemaResolver
	schemaStore  JSONSchemaStore
	fields       FlowFieldResolver
	userCreater  FlowOnSuccessHandler
	authAttempts FlowAuthAttemptService
	now          func() time.Time
}

// NewFlowStateMachine wires the runtime. The now hook is injectable so
// tests can produce deterministic [FlowState.IssuedAt] values.
func NewFlowStateMachine(
	schemas SchemaResolver,
	schemaStore JSONSchemaStore,
	fields FlowFieldResolver,
	createUser FlowOnSuccessHandler,
	authAttempts FlowAuthAttemptService,
	now func() time.Time,
) *FlowStateMachineRuntime {
	if now == nil {
		now = time.Now
	}
	return &FlowStateMachineRuntime{
		schemas:      schemas,
		schemaStore:  schemaStore,
		fields:       fields,
		userCreater:  createUser,
		authAttempts: authAttempts,
		now:          now,
	}
}

var _ FlowStateMachine = (*FlowStateMachineRuntime)(nil)

func (r *FlowStateMachineRuntime) Start(ctx context.Context, in FlowStartInput) (FlowStepResult, error) {
	if in.Definition == nil {
		return FlowStepResult{}, fmt.Errorf("%w: start without definition", ErrFlowIntegrity())
	}
	initialStepName, ok := in.Definition.InitialStepFor(in.Purpose)
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: definition %q does not serve purpose %s", ErrFlowIntegrity(), in.Definition.ID, in.Purpose)
	}

	state := &FlowState{
		ProjectID:     in.Definition.ProjectID,
		UserSchemaURL: in.UserSchemaURL,
		FlowProgress: FlowProgress{
			DefinitionID:   in.Definition.ID,
			Purpose:        in.Purpose,
			CurrentPurpose: in.Purpose,
			CurrentStep:    initialStepName,
			History:        nil,
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
		return FlowStepResult{}, fmt.Errorf("%w: auth-attempt service not wired", ErrFlowIntegrity())
	}
	attemptInput := FlowCreateAttemptInput{ProjectID: state.ProjectID}
	if state.SessionID != "" {
		sid := state.SessionID
		attemptInput.SessionID = &sid
	}
	attemptID, err := r.authAttempts.Start(ctx, attemptInput)
	if err != nil {
		return FlowStepResult{}, fmt.Errorf("flow state machine: start auth attempt: %w", err)
	}
	state.AuthAttemptID = attemptID

	step, err := r.renderStep(ctx, in.Definition, state)
	if err != nil {
		return FlowStepResult{}, err
	}
	return FlowStepResult{State: state, Step: step}, nil
}

// Render re-emits the current step without advancing. Refreshes IssuedAt
// so the cookie max-age window slides while the user is on the step.
func (r *FlowStateMachineRuntime) Render(ctx context.Context, def *FlowDefinition, state *FlowState) (FlowStepResult, error) {
	if def == nil || state == nil {
		return FlowStepResult{}, fmt.Errorf("%w: render without definition or state", ErrFlowIntegrity())
	}
	step, err := r.renderStep(ctx, def, state)
	if err != nil {
		return FlowStepResult{}, err
	}
	// Re-emit an in-flight ceremony so a page reload can resume it.
	attachPendingChallenge(step, state.PendingChallenge)
	state.IssuedAt = r.now()
	return FlowStepResult{State: state, Step: step}, nil
}

// processCtx carries the per-submission context threaded through the
// per-kind methods and their helpers.
type processCtx struct {
	ctx         context.Context
	def         *FlowDefinition
	state       *FlowState
	currentStep *FlowDefinitionStep
	in          FlowSubmitInput
}

// Process advances the flow one step by dispatching the submission to
// the handler for its action kind.
func (r *FlowStateMachineRuntime) Process(ctx context.Context, def *FlowDefinition, state *FlowState, in FlowSubmitInput) (FlowStepResult, error) {
	if def == nil || state == nil {
		return FlowStepResult{}, fmt.Errorf("%w: process without definition or state", ErrFlowIntegrity())
	}
	if in.SSOProvider != nil {
		return FlowStepResult{}, fmt.Errorf("%w: sso submissions", ErrFlowUnsupported())
	}
	if len(in.GateProofs) > 0 {
		return FlowStepResult{}, fmt.Errorf("%w: gate proofs", ErrFlowUnsupported())
	}

	currentStep, ok := def.FindStep(state.CurrentStep)
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: current step %q missing from definition", ErrFlowIntegrity(), state.CurrentStep)
	}

	pc := &processCtx{ctx: ctx, def: def, state: state, currentStep: currentStep, in: in}
	actionKind := stepActionKind(currentStep, in.Action)

	// Back and Navigate both skip the input pipeline entirely.
	if actionKind == FlowActionKindBack {
		return r.processBack(pc)
	}
	if actionKind == FlowActionKindNavigate {
		// Navigating abandons any pending ceremony; without this the
		// stale challenge re-attaches on the next render (the mismatch
		// cleanup below never runs on this early-return path).
		state.ClearPendingChallenge()
		return r.routeOutcome(pc, FlowResolvedFields{}, in.Action, false)
	}

	// Every other kind resolves the step's inputs, then validates and
	// merges what the client sent.
	resolved, err := r.resolveInputs(pc)
	if err != nil {
		return FlowStepResult{}, err
	}
	halt, err := r.validateAndMerge(pc, resolved, actionKind)
	if err != nil {
		return FlowStepResult{}, err
	}
	if halt != nil {
		return *halt, nil
	}

	// If a ceremony is pending and the user picked a different action,
	// drop it so we don't re-emit the abandoned prompt.
	if state.PendingChallenge != nil && in.ChallengeResponse == nil &&
		!pendingMatchesKind(state.PendingChallenge.Method, in.Action, actionKind) {
		state.ClearPendingChallenge()
	}

	switch actionKind {
	case FlowActionKindPasskey:
		return r.processPasskeyLogin(pc, resolved)
	case FlowActionKindPasskeyRegister:
		return r.processPasskeyRegister(pc, resolved)
	default:
		// Submit and unset-kind actions both go here. An unknown
		// user-supplied action lands here too and fails inside routeOutcome.
		return r.processSubmit(pc, resolved)
	}
}

// resolveInputs resolves the step's fields and prefills any values the
// user already supplied on earlier steps.
func (r *FlowStateMachineRuntime) resolveInputs(pc *processCtx) (FlowResolvedFields, error) {
	resolved, err := r.resolveStepFields(pc.ctx, pc.state, pc.currentStep)
	if err != nil {
		return FlowResolvedFields{}, err
	}
	prefillFromCollected(&resolved, pc.state.CollectedData.UserData)
	return resolved, nil
}

// validateAndMerge checks the submitted values and, on success, folds
// them into CollectedData. Returns a rendered halt step on validation
// failure.
//
// Every action validates the values it sent; field-collecting actions
// (see [collectsStepFields]) additionally require declared required fields
// to be present.
//
// TODO: Validate rejects an empty required field the client did submit,
// on every action. So "sign in with passkey" on a step with a required
// password fails, because the client sends password="" with it. The check
// should depend on the action — but an empty identifier on a passkey leg
// can be a valid rejection, so we can't just skip it everywhere.
// Pre-existing; add a password-step test when fixed.
func (r *FlowStateMachineRuntime) validateAndMerge(pc *processCtx, resolved FlowResolvedFields, actionKind FlowActionKind) (*FlowStepResult, error) {
	var errs FlowFieldValidationErrors
	if validationErr := r.fields.Validate(resolved, pc.in.Fields); validationErr != nil {
		v, ok := errors.AsType[FlowFieldValidationErrors](validationErr)
		if !ok {
			return nil, fmt.Errorf("flow state machine: validate fields: %w", validationErr)
		}
		errs = append(errs, v...)
	}
	if collectsStepFields(actionKind, pc.in) {
		errs = append(errs, r.fields.MissingRequired(resolved, pc.in.Fields)...)
	}
	if len(errs) > 0 {
		sortFlowFieldValidationErrors(errs)
		step := r.buildStep(pc.state, pc.currentStep, resolved, new(errs.StepError()), nil, nil)
		pc.state.IssuedAt = r.now()
		return &FlowStepResult{State: pc.state, Step: step}, nil
	}

	if err := mergeCollected(pc.state, pc.in.Fields); err != nil {
		return nil, fmt.Errorf("flow state machine: validate fields: %w", err)
	}

	return nil, nil
}

// renderStepError re-renders the current step with an error key set,
// so the user stays put and sees what went wrong.
func (r *FlowStateMachineRuntime) renderStepError(pc *processCtx, resolved FlowResolvedFields, errKey *string) FlowStepResult {
	step := r.buildStep(pc.state, pc.currentStep, resolved, errKey, nil, nil)
	pc.state.IssuedAt = r.now()
	return FlowStepResult{State: pc.state, Step: step}
}

// routeOutcome sends the user to the next step: looks up the
// transition for outcome, flips the purpose, advances state, then
// renders (or terminates on a terminal step). When outcome differs
// from the user-submitted action it came from a handler diversion
// (e.g. user_not_found); a missing transition in that case degrades
// to a step error instead of ErrFlowInvalidAction. If irreversible,
// BackStack is dropped after advance.
func (r *FlowStateMachineRuntime) routeOutcome(pc *processCtx, resolved FlowResolvedFields, outcome string, irreversible bool) (FlowStepResult, error) {
	transition, ok := pc.currentStep.Transitions[outcome]
	if !ok {
		if outcome != pc.in.Action {
			msg := outcome
			return r.renderStepError(pc, resolved, &msg), nil
		}
		return FlowStepResult{}, fmt.Errorf("%w: %q on step %q", ErrFlowInvalidAction(), pc.in.Action, pc.currentStep.Name)
	}
	if transition.Action != nil {
		return FlowStepResult{}, fmt.Errorf("%w: cross-flow transitions", ErrFlowUnsupported())
	}

	nextStep, ok := pc.def.FindStep(transition.Target)
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: transition target %q missing from definition", ErrFlowIntegrity(), transition.Target)
	}

	// Snapshot purpose before the flip so back can restore it.
	prevPurpose := pc.state.CurrentPurpose
	applyOutcomeFlip(pc.state, outcome)
	// A declared transition purpose wins over the implicit outcome flip.
	// Only CurrentPurpose moves; the pinned Purpose stays for telemetry/ACR.
	// Unlike the implicit flips (which continue an in-flight resolution,
	// e.g. register + user_already_exists verifying the found user), a
	// declared re-purpose starts the target purpose fresh: the resolved
	// user, collected credential material, and ceremony state must not
	// leak across. A login-resolved user surviving into register would
	// let passkey registration attach a credential to an existing account
	// without proving a factor.
	repurposeUndo := false
	if transition.Purpose != nil {
		hadResolvedUser := pc.state.CollectedData.UserID != ""
		clearUserBoundState(pc.state)
		pc.state.CollectedData.AuthMethods.Password = ""
		if hadResolvedUser {
			// The persisted attempt carries the resolved user as a factor,
			// and PrepareUserChallenge refuses a second user challenge on a
			// session-linked attempt. The flow-state reset must rotate the
			// attempt in lockstep or the next identifier submission dies on
			// "The user was already authenticated". The abandoned attempt
			// ages out like any abandoned flow. No resolved user → nothing
			// on the attempt to escape → no rotation (idle purpose toggles
			// must not mint attempt rows).
			attemptInput := FlowCreateAttemptInput{ProjectID: pc.state.ProjectID}
			if pc.state.SessionID != "" {
				sid := pc.state.SessionID
				attemptInput.SessionID = &sid
			}
			attemptID, err := r.authAttempts.Start(pc.ctx, attemptInput)
			if err != nil {
				return FlowStepResult{}, fmt.Errorf("flow state machine: rotate auth attempt on re-purpose: %w", err)
			}
			pc.state.AuthAttemptID = attemptID
		}
		pc.state.CurrentPurpose = *transition.Purpose

		// Purpose entries link to each other, forming a zero-input loop.
		// An exact undo of the previous navigation pops the back stack
		// instead of pushing, so toggling Sign up / Sign in cannot grow
		// History/BackStack past one entry (unbounded growth overflows
		// the 4 KiB encrypted-cookie budget). Anything else falls through
		// to the normal advance.
		if top, ok := pc.state.PeekBackStack(); ok &&
			top.StepName == nextStep.Name && top.Purpose == *transition.Purpose &&
			len(pc.state.History) > 0 && pc.state.History[len(pc.state.History)-1] == top.StepName {
			pc.state.PopBackStack()
			pc.state.History = pc.state.History[:len(pc.state.History)-1]
			pc.state.CurrentStep = nextStep.Name
			pc.state.IssuedAt = r.now()
			repurposeUndo = true
		}
	}

	if !repurposeUndo {
		r.advance(pc.state, pc.currentStep, prevPurpose, nextStep.Name)
	}

	// after irreversible actions, clear the back stack so the user can't navigate back in the flow.
	if irreversible {
		pc.state.ClearBackStack()
	}

	if nextStep.Complete != nil {
		return r.terminate(pc, nextStep)
	}

	step, err := r.renderStep(pc.ctx, pc.def, pc.state)
	if err != nil {
		return FlowStepResult{}, err
	}
	return FlowStepResult{State: pc.state, Step: step}, nil
}

// processSubmit handles kind=submit: dispatch challenges, run
// on_success (if declared), and route the resulting outcome.
func (r *FlowStateMachineRuntime) processSubmit(pc *processCtx, resolved FlowResolvedFields) (FlowStepResult, error) {
	dispatch, err := r.dispatchChallenges(pc, resolved)
	if err != nil {
		return FlowStepResult{}, err
	}
	if dispatch.StepError != nil {
		return r.renderStepError(pc, resolved, dispatch.StepError), nil
	}
	if dispatch.Outcome != "" {
		return r.routeOutcome(pc, resolved, dispatch.Outcome, false)
	}
	if pc.currentStep.OnSuccess == nil {
		return r.routeOutcome(pc, resolved, pc.in.Action, false)
	}

	// on_success reads across every visited step, not just the current one.
	visitedResolved, err := r.resolveVisitedFields(pc)
	if err != nil {
		return FlowStepResult{}, err
	}
	result, err := r.runOnSuccess(pc, visitedResolved)
	if err != nil {
		return FlowStepResult{}, err
	}
	if result.StepError != nil {
		return r.renderStepError(pc, resolved, result.StepError), nil
	}
	if result.UserID != "" {
		// The handler already recorded the user's factors on the attempt
		// inside its own transaction; only the flow state needs the id.
		recordResolvedUser(pc.state, result.UserID)
	}
	return r.routeOutcome(pc, resolved, pc.in.Action, result.Irreversible)
}

// processPasskeyLogin handles kind=passkey. The issue leg runs
// identifier dispatch first so IssuePasskeyChallenge can populate
// allowCredentials; the verify leg validates the assertion. Ceremony
// abandonment falls through to the standard pipeline.
func (r *FlowStateMachineRuntime) processPasskeyLogin(pc *processCtx, resolved FlowResolvedFields) (FlowStepResult, error) {
	if pc.in.ChallengeResponse == nil {
		dispatch, err := r.dispatchChallenges(pc, resolved)
		if err != nil {
			return FlowStepResult{}, err
		}
		if dispatch.StepError != nil {
			return r.renderStepError(pc, resolved, dispatch.StepError), nil
		}
		if dispatch.Outcome != "" {
			// user_not_found and the like — skip the ceremony and route directly.
			return r.routeOutcome(pc, resolved, dispatch.Outcome, false)
		}
	}

	pk, err := r.processPasskey(pc, resolved, resolved, FlowActionKindPasskey)
	if err != nil {
		return FlowStepResult{}, err
	}
	if pk.halt != nil {
		return *pk.halt, nil
	}
	if !pk.handled {
		// Ceremony was abandoned (pending challenge didn't match the
		// submitted action): treat the submit as a plain kind=submit so
		// the user still gets a response.
		return r.processSubmit(pc, resolved)
	}
	if pk.outcome != "" {
		return r.routeOutcome(pc, resolved, pk.outcome, false)
	}

	return r.routeOutcome(pc, resolved, pc.in.Action, pk.irreversible)
}

// processPasskeyRegister handles kind=passkey_register. Uses the
// visited-fields union so the display name can pull attributes from
// earlier steps. Ceremony abandonment falls back to the standard
// pipeline, same as login.
func (r *FlowStateMachineRuntime) processPasskeyRegister(pc *processCtx, resolved FlowResolvedFields) (FlowStepResult, error) {
	passkeyResolved := resolved
	if needsPasskeyRegistrationVisitedFields(pc.state, pc.in, FlowActionKindPasskeyRegister) {
		visitedResolved, err := r.resolveVisitedFields(pc)
		if err != nil {
			return FlowStepResult{}, err
		}
		passkeyResolved = visitedResolved
	}

	pk, err := r.processPasskey(pc, resolved, passkeyResolved, FlowActionKindPasskeyRegister)
	if err != nil {
		return FlowStepResult{}, err
	}
	if pk.halt != nil {
		return *pk.halt, nil
	}
	if !pk.handled {
		// Ceremony was abandoned (pending challenge didn't match the
		// submitted action): treat the submit as a plain kind=submit so
		// the user still gets a response.
		return r.processSubmit(pc, resolved)
	}
	if pk.outcome != "" {
		return r.routeOutcome(pc, resolved, pk.outcome, false)
	}

	return r.routeOutcome(pc, resolved, pc.in.Action, pk.irreversible)
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

// applyOutcomeFlip flips CurrentPurpose on identifier outcomes:
// login + user_not_found → register; register + user_already_exists → login.
// Recovery never flips.
func applyOutcomeFlip(state *FlowState, outcome string) {
	switch {
	case state.CurrentPurpose == FlowDefinitionPurposeLogin && outcome == FlowImplicitOutcomeUserNotFound:
		state.CurrentPurpose = FlowDefinitionPurposeRegister
	case state.CurrentPurpose == FlowDefinitionPurposeRegister && outcome == FlowImplicitOutcomeUserAlreadyExists:
		state.CurrentPurpose = FlowDefinitionPurposeLogin
	}
}

// dispatchChallenges submits field-shaped challenges in
// [challengeDispatchOrder]. CurrentPurpose + visited on_success decide
// verify-vs-skip.
func (r *FlowStateMachineRuntime) dispatchChallenges(pc *processCtx, resolved FlowResolvedFields) (flowDispatchResult, error) {
	ctx, def, state, step, fields := pc.ctx, pc.def, pc.state, pc.currentStep, pc.in.Fields
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
				if state.CurrentPurpose == FlowDefinitionPurposeRegister {
					continue
				}
				clearUserBoundState(state)
				return flowDispatchResult{Outcome: FlowImplicitOutcomeUserNotFound}, nil
			}
			if err != nil {
				return flowDispatchResult{}, fmt.Errorf("flow state machine: submit identifier: %w", err)
			}
			if state.CurrentPurpose == FlowDefinitionPurposeRegister {
				return flowDispatchResult{Outcome: FlowImplicitOutcomeUserAlreadyExists}, nil
			}
			recordResolvedUser(state, userID)
		case FlowFieldChallengePassword:
			if state.CurrentPurpose != FlowDefinitionPurposeLogin {
				continue
			}
			// Skip if any visited step runs an on_success — today the only
			// one (create_user) establishes the password kind, and the
			// validator enforces password-collected-upstream for it.
			if anyVisitedStepOnSuccess(def, state, step) {
				continue
			}
			err := r.authAttempts.SubmitPassword(ctx, FlowSubmitPasswordInput{
				ProjectID: state.ProjectID,
				AttemptID: state.AuthAttemptID,
				Plain:     value,
			})
			if errors.Is(err, ErrAuthAttemptProofRejected(nil)) {
				msg := FlowStepErrorInvalidCredentials
				return flowDispatchResult{StepError: &msg}, nil
			}
			if err != nil {
				return flowDispatchResult{}, fmt.Errorf("flow state machine: submit password: %w", err)
			}
		}
	}
	return flowDispatchResult{}, nil
}

// anyVisitedStepOnSuccess reports whether any step in (history ∪ current)
// runs an on_success mutation.
func anyVisitedStepOnSuccess(def *FlowDefinition, state *FlowState, current *FlowDefinitionStep) bool {
	if current.OnSuccess != nil {
		return true
	}
	for _, name := range state.History {
		if s, ok := def.FindStep(name); ok && s.OnSuccess != nil {
			return true
		}
	}
	return false
}

// identifierFieldValues returns every identifier-class field with a collected
// value, in field order and deduplicated by name across the given resolved
// sets. Every x-unique property resolves as an identifier field, so this is
// the candidate list for locating the owner of a conflicting unique value.
func identifierFieldValues(values map[string]any, resolvedSets ...FlowResolvedFields) [][2]string {
	var out [][2]string
	seen := map[string]bool{}
	for _, resolved := range resolvedSets {
		for _, field := range resolved.Fields {
			if field.Challenge != FlowFieldChallengeIdentifier || seen[field.Name] {
				continue
			}
			raw, present := values[field.Name]
			if !present {
				continue
			}
			s, _ := raw.(string)
			if s == "" {
				continue
			}
			seen[field.Name] = true
			out = append(out, [2]string{field.Name, s})
		}
	}
	return out
}

func fieldValueByChallenge(resolved FlowResolvedFields, fields map[string]any, target FlowFieldChallenge) (name, value string, ok bool) {
	for _, field := range resolved.Fields {
		if field.Challenge != target {
			continue
		}
		raw, present := fields[field.Name]
		if !present {
			continue
		}
		s, _ := raw.(string)
		return field.Name, s, true
	}
	return "", "", false
}

// passkeyPhaseResult reports how the two-phase passkey handler interacted
// with a submission. handled is true when a passkey leg ran (so the
// field-shaped dispatch must be skipped); halt, when non-nil, is the result
// to return immediately (challenge issued and awaiting proof, or a
// verification error rendered on the step); outcome, when set, diverts
// routing (e.g. user_already_exists from a provisional registration).
type passkeyPhaseResult struct {
	handled      bool
	irreversible bool
	outcome      string
	halt         *FlowStepResult
}

// processPasskey runs all two-phase WebAuthn ceremonies (authentication and
// registration) for the current step:
//   - resume/abandon leg: a challenge is pending and no proof has arrived. If
//     the submission targets the same ceremony (or is action-less), re-emit
//     the pending challenge. Otherwise the user picked a different action;
//     drop the pending challenge and let normal routing run.
//   - verify leg: a ChallengeResponse arrived → dispatch to the right service
//     based on PendingChallenge.Method, clear the pending challenge, and let
//     Process route via the submitted action.
//   - issue leg (auth): step offers a `passkey` action and it was selected →
//     mint an assertion challenge; discoverable login allowed when no user is
//     yet identified.
//   - issue leg (register): step offers a `passkey_register` action and it
//     was selected → use the collected user id (or let the registration
//     service mint a provisional one), then issue a creation challenge.
func (r *FlowStateMachineRuntime) processPasskey(pc *processCtx, resolved FlowResolvedFields, passkeyResolved FlowResolvedFields, actionKind FlowActionKind) (passkeyPhaseResult, error) {
	ctx, state, step, in := pc.ctx, pc.state, pc.currentStep, pc.in
	switch {
	// A ceremony is in flight but no proof arrived: resume or abandon.
	case state.PendingChallenge != nil && in.ChallengeResponse == nil:
		if !pendingMatchesKind(state.PendingChallenge.Method, in.Action, actionKind) {
			state.ClearPendingChallenge()
			return passkeyPhaseResult{}, nil
		}
		rendered := r.buildStep(pc.state, pc.currentStep, resolved, nil, nil, nil)
		attachPendingChallenge(rendered, state.PendingChallenge)
		state.IssuedAt = r.now()
		return passkeyPhaseResult{handled: true, halt: &FlowStepResult{State: state, Step: rendered}}, nil

	// A proof arrived: verify it (pending may be missing if the cookie
	// was lost mid-ceremony; the DB rejects unknown challenge ids).
	case in.ChallengeResponse != nil:
		// The server-issued id is authoritative; never trust a client-supplied
		// one to rebind the proof to a different challenge.
		challengeID := in.ChallengeResponse.ChallengeID
		method := in.ChallengeResponse.Method
		if state.PendingChallenge != nil {
			challengeID = state.PendingChallenge.ID
			method = state.PendingChallenge.Method
		}

		switch method {
		case FlowChallengeMethodPasskeyRegister:
			// The verify transaction persists the credential, the user row
			// (when the ceremony is provisional), and the attempt factors
			// atomically — the attempt service decides provisional-or-not
			// from the stored challenge.
			err := r.authAttempts.SubmitPasskeyRegistration(ctx, FlowSubmitPasskeyRegistrationInput{
				ProjectID:      state.ProjectID,
				AttemptID:      state.AuthAttemptID,
				UserID:         state.CollectedData.UserID,
				ChallengeID:    challengeID,
				Attestation:    in.ChallengeResponse.Proof,
				UserSchemaURL:  state.UserSchemaURL,
				UserAttributes: state.CollectedData.UserData,
			})
			if errors.Is(err, ErrAuthAttemptProofRejected(nil)) {
				state.ClearPendingChallenge()
				msg := FlowStepErrorPasskeyRegistrationInvalid
				rendered := r.buildStep(pc.state, pc.currentStep, resolved, &msg, nil, nil)
				state.IssuedAt = r.now()
				return passkeyPhaseResult{handled: true, halt: &FlowStepResult{State: state, Step: rendered}}, nil
			}
			if errors.Is(err, ErrUserAlreadyExists()) {
				// A unique attribute of the provisional user is taken: route
				// like the identifier dispatch does. That path pins the
				// existing user on the attempt before routing — and the
				// downstream password step requires a persisted user factor —
				// so re-resolve the conflicting owner here to land in the
				// same state. Every x-unique property resolves as an
				// identifier-class field, so trying each collected one finds
				// the owner even when the race was lost on a non-identifier
				// unique attribute (e.g. a fresh email but a taken phone).
				clearUserBoundState(state)
				candidates := identifierFieldValues(state.CollectedData.UserData, passkeyResolved)
				if visited, verr := r.resolveVisitedFields(pc); verr == nil {
					candidates = identifierFieldValues(state.CollectedData.UserData, passkeyResolved, visited)
				}
				for _, candidate := range candidates {
					userID, rerr := r.authAttempts.SubmitIdentifier(ctx, FlowSubmitIdentifierInput{
						ProjectID:     state.ProjectID,
						AttemptID:     state.AuthAttemptID,
						AttributeName: candidate[0],
						Value:         candidate[1],
					})
					if rerr == nil {
						recordResolvedUser(state, userID)
						break
					}
					if !errors.Is(rerr, ErrAuthAttemptProofRejected(nil)) {
						return passkeyPhaseResult{}, fmt.Errorf("flow state machine: resolve conflicting user: %w", rerr)
					}
					// Rejected means this field's value is not the taken one
					// (or the owner vanished again); try the next candidate.
					// All-rejected routes anyway and the next step re-collects.
				}
				return passkeyPhaseResult{handled: true, outcome: FlowImplicitOutcomeUserAlreadyExists}, nil
			}
			if errors.Is(err, ErrAuthAttemptStaleChallenge()) {
				// The ceremony window is tighter than the attempt TTL, and a
				// deploy can strand an in-flight ceremony too. Clear the
				// pending challenge so a retry mints a fresh one instead of
				// re-emitting the stale ceremony until the attempt dies.
				state.ClearPendingChallenge()
				msg := FlowStepErrorPasskeyRegistrationInvalid
				rendered := r.buildStep(pc.state, pc.currentStep, resolved, &msg, nil, nil)
				state.IssuedAt = r.now()
				return passkeyPhaseResult{handled: true, halt: &FlowStepResult{State: state, Step: rendered}}, nil
			}
			if err != nil {
				return passkeyPhaseResult{}, fmt.Errorf("flow state machine: submit passkey registration: %w", err)
			}
			recordResolvedUser(state, state.CollectedData.UserID)
			state.ClearPendingChallenge()
			// Registration wrote a credential — the user cannot back out.
			return passkeyPhaseResult{handled: true, irreversible: true}, nil

		default: // FlowChallengeMethodPasskey
			userID, err := r.authAttempts.SubmitPasskey(ctx, FlowSubmitPasskeyInput{
				ProjectID:   state.ProjectID,
				AttemptID:   state.AuthAttemptID,
				ChallengeID: challengeID,
				Assertion:   in.ChallengeResponse.Proof,
			})
			if errors.Is(err, ErrAuthAttemptProofRejected(nil)) || errors.Is(err, ErrAuthAttemptStaleChallenge()) {
				// Both a rejected assertion and a stale challenge (e.g. after
				// a deploy) render on the step with the pending ceremony
				// cleared, so a retry mints a fresh challenge.
				state.ClearPendingChallenge()
				msg := FlowStepErrorPasskeyInvalid
				rendered := r.buildStep(pc.state, pc.currentStep, resolved, &msg, nil, nil)
				state.IssuedAt = r.now()
				return passkeyPhaseResult{handled: true, halt: &FlowStepResult{State: state, Step: rendered}}, nil
			}
			if err != nil {
				return passkeyPhaseResult{}, fmt.Errorf("flow state machine: submit passkey: %w", err)
			}
			recordResolvedUser(state, userID)
			state.ClearPendingChallenge()
			return passkeyPhaseResult{handled: true}, nil
		}

	case actionKind == FlowActionKindPasskey:
		if !stepHasActionKind(step, FlowActionKindPasskey) {
			return passkeyPhaseResult{}, nil
		}
		if in.PasskeyRP == nil {
			return passkeyPhaseResult{}, fmt.Errorf("%w: passkey relying-party params missing", ErrFlowIntegrity())
		}
		out, err := r.authAttempts.IssuePasskeyChallenge(ctx, FlowIssuePasskeyChallengeInput{
			ProjectID:        state.ProjectID,
			AttemptID:        state.AuthAttemptID,
			RPID:             in.PasskeyRP.RPID,
			RPOrigins:        in.PasskeyRP.Origins,
			UserVerification: flowPasskeyDefaultUserVerification,
		})
		if err != nil {
			return passkeyPhaseResult{}, fmt.Errorf("flow state machine: issue passkey: %w", err)
		}
		state.PendingChallenge = &FlowPendingChallenge{
			ID:       out.ChallengeID,
			Method:   FlowChallengeMethodPasskey,
			Options:  out.Options,
			IssuedAt: r.now(),
		}
		rendered := r.buildStep(pc.state, pc.currentStep, resolved, nil, nil, nil)
		attachPendingChallenge(rendered, state.PendingChallenge)
		state.IssuedAt = r.now()
		return passkeyPhaseResult{handled: true, halt: &FlowStepResult{State: state, Step: rendered}}, nil

	case actionKind == FlowActionKindPasskeyRegister:
		if !stepHasActionKind(step, FlowActionKindPasskeyRegister) {
			return passkeyPhaseResult{}, nil
		}
		if in.PasskeyRP == nil {
			return passkeyPhaseResult{}, fmt.Errorf("%w: passkey relying-party params missing", ErrFlowIntegrity())
		}
		username, displayName := passkeyRegistrationDisplay(passkeyResolved, state.CollectedData.UserData)
		out, err := r.authAttempts.IssuePasskeyRegistrationChallenge(ctx, FlowIssuePasskeyRegistrationChallengeInput{
			ProjectID:   state.ProjectID,
			AttemptID:   state.AuthAttemptID,
			UserID:      state.CollectedData.UserID,
			Username:    username,
			DisplayName: displayName,
			RPID:        in.PasskeyRP.RPID,
			RPOrigins:   in.PasskeyRP.Origins,
		})
		if err != nil {
			return passkeyPhaseResult{}, fmt.Errorf("flow state machine: issue passkey registration: %w", err)
		}
		// Keep the (possibly minted) user handle so a re-issued challenge
		// stays stable and the verify leg knows which user it targets.
		state.CollectedData.UserID = out.UserID
		state.PendingChallenge = &FlowPendingChallenge{
			ID:       out.ChallengeID,
			Method:   FlowChallengeMethodPasskeyRegister,
			Options:  out.Options,
			IssuedAt: r.now(),
		}
		rendered := r.buildStep(pc.state, pc.currentStep, resolved, nil, nil, nil)
		attachPendingChallenge(rendered, state.PendingChallenge)
		state.IssuedAt = r.now()
		return passkeyPhaseResult{handled: true, halt: &FlowStepResult{State: state, Step: rendered}}, nil
	}
	return passkeyPhaseResult{}, nil
}

func needsPasskeyRegistrationVisitedFields(state *FlowState, in FlowSubmitInput, actionKind FlowActionKind) bool {
	if actionKind == FlowActionKindPasskeyRegister && in.ChallengeResponse == nil {
		return true
	}
	if in.ChallengeResponse == nil {
		return false
	}
	if state != nil && state.PendingChallenge != nil {
		return state.PendingChallenge.Method == FlowChallengeMethodPasskeyRegister
	}
	return in.ChallengeResponse.Method == FlowChallengeMethodPasskeyRegister
}

func passkeyRegistrationDisplay(resolved FlowResolvedFields, collected map[string]any) (string, string) {
	_, _, value, ok := FindCollectedFieldByChallenge(resolved.Fields, collected, FlowFieldChallengeIdentifier)
	if !ok {
		return "", ""
	}
	svalue, _ := value.(string)
	label := strings.TrimSpace(svalue)
	if label == "" {
		return "", ""
	}
	return label, label
}

// pendingMatchesKind reports whether a no-proof POST should resume the
// pending ceremony (vs. abandon it). An empty submitted action covers
// passive POSTs; otherwise the submitted action's kind must match the
// pending ceremony's method.
func pendingMatchesKind(pendingMethod, submittedAction string, submittedKind FlowActionKind) bool {
	if submittedAction == "" {
		return true
	}
	switch pendingMethod {
	case FlowChallengeMethodPasskey:
		return submittedKind == FlowActionKindPasskey
	case FlowChallengeMethodPasskeyRegister:
		return submittedKind == FlowActionKindPasskeyRegister
	}
	return false
}

// attachPendingChallenge surfaces a pending ceremony on a rendered step so the
// client can run it (and re-run it on a plain GET re-render).
func attachPendingChallenge(step *FlowStep, pc *FlowPendingChallenge) {
	if step == nil || pc == nil {
		return
	}
	step.Challenge = &FlowStepChallenge{
		Method:      pc.Method,
		ChallengeID: pc.ID,
		Options:     pc.Options,
	}
}

// runOnSuccess dispatches the step's on_success mutation. Add a case
// when a new [FlowOnSuccess] handler lands.
func (r *FlowStateMachineRuntime) runOnSuccess(pc *processCtx, resolved FlowResolvedFields) (FlowOnSuccessResult, error) {
	switch *pc.currentStep.OnSuccess {
	case FlowOnSuccessCreateUser:
		return r.userCreater.Handle(pc.ctx, FlowOnSuccessInput{
			ProjectID:     pc.state.ProjectID,
			UserSchemaURL: pc.state.UserSchemaURL,
			Fields:        pc.in.Fields,
			Resolved:      resolved,
			State:         pc.state,
			ResolvedFlow:  pc.def,
		})
	default:
		return FlowOnSuccessResult{}, fmt.Errorf("%w: on_success %s not wired", ErrFlowIntegrity(), *pc.currentStep.OnSuccess)
	}
}

// advance records the transition. prevPurpose is captured before the
// outcome flip so `back` can restore both step and purpose.
func (r *FlowStateMachineRuntime) advance(state *FlowState, prev *FlowDefinitionStep, prevPurpose FlowDefinitionPurpose, nextStepName string) {
	state.History = append(state.History, prev.Name)
	state.BackStack = append(state.BackStack, FlowBackEntry{StepName: prev.Name, Purpose: prevPurpose})
	state.CurrentStep = nextStepName
	state.IssuedAt = r.now()
}

// processBack pops the previous BackStack entry and re-renders that
// step, restoring the snapshotted purpose. CollectedData is preserved
// (previous form prefills); PendingChallenge is dropped; History is
// left intact.
func (r *FlowStateMachineRuntime) processBack(pc *processCtx) (FlowStepResult, error) {
	prev, ok := pc.state.PeekBackStack()
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: back submitted with empty back stack on step %q", ErrFlowInvalidAction(), pc.state.CurrentStep)
	}
	if _, ok := pc.def.FindStep(prev.StepName); !ok {
		return FlowStepResult{}, fmt.Errorf("%w: back-stack step %q missing from definition", ErrFlowIntegrity(), prev.StepName)
	}
	pc.state.PopBackStack()
	pc.state.CurrentStep = prev.StepName
	pc.state.CurrentPurpose = prev.Purpose
	pc.state.ClearPendingChallenge()

	step, err := r.renderStep(pc.ctx, pc.def, pc.state)
	if err != nil {
		return FlowStepResult{}, err
	}
	pc.state.IssuedAt = r.now()
	return FlowStepResult{State: pc.state, Step: step}, nil
}

// terminate renders a completed step and, when a user was resolved,
// mints the handoff. Clears BackStack — no back past a
// point-of-no-return.
func (r *FlowStateMachineRuntime) terminate(pc *processCtx, step *FlowDefinitionStep) (FlowStepResult, error) {
	pc.state.ClearBackStack()
	rendered, err := r.renderStep(pc.ctx, pc.def, pc.state)
	if err != nil {
		return FlowStepResult{}, err
	}
	kind := *step.Complete
	rendered.Complete = &kind
	if kind == FlowStepCompleteRedirect && pc.state.RedirectURI != nil {
		uri := *pc.state.RedirectURI
		rendered.RedirectURL = &uri
	}

	// Skip handoff when no user was resolved (e.g. user_not_found →
	// no-account). PrepareHandoff can't catch this today: attempts are
	// started with empty RequiredChecks, so IsCompleted is vacuously
	// true and a token would be minted. Remove once the policy engine
	// populates RequiredChecks.
	if pc.state.CollectedData.UserID == "" {
		return FlowStepResult{State: pc.state, Step: rendered}, nil
	}

	if pc.state.AuthAttemptID == "" {
		return FlowStepResult{}, fmt.Errorf("%w: terminate without auth attempt id", ErrFlowIntegrity())
	}
	handoff, err := r.authAttempts.Handoff(pc.ctx, FlowHandoffInput{
		ProjectID: pc.state.ProjectID,
		AttemptID: pc.state.AuthAttemptID,
	})
	if err != nil {
		return FlowStepResult{}, fmt.Errorf("flow state machine: handoff: %w", err)
	}
	return FlowStepResult{
		State:                 pc.state,
		Step:                  rendered,
		HandoffToken:          handoff.Token,
		HandoffTokenExpiresAt: handoff.ExpiresAt,
	}, nil
}

// renderStep renders the step currently pinned by state.CurrentStep.
// Callers advance state (or pop for back) before invoking so
// state.CurrentStep already points at the step they want rendered.
func (r *FlowStateMachineRuntime) renderStep(ctx context.Context, def *FlowDefinition, state *FlowState) (*FlowStep, error) {
	step, ok := def.FindStep(state.CurrentStep)
	if !ok {
		return nil, fmt.Errorf("%w: render unknown step %q", ErrFlowIntegrity(), state.CurrentStep)
	}
	resolved, err := r.resolveStepFields(ctx, state, step)
	if err != nil {
		return nil, err
	}
	prefillFromCollected(&resolved, state.CollectedData.UserData)
	return r.buildStep(state, step, resolved, nil, nil, nil), nil
}

func (r *FlowStateMachineRuntime) resolveStepFields(ctx context.Context, state *FlowState, step *FlowDefinitionStep) (FlowResolvedFields, error) {
	if len(step.Fields) == 0 {
		return FlowResolvedFields{}, nil
	}
	schema, err := r.schemas.Resolve(ctx, r.schemaStore, state.ProjectID, state.UserSchemaURL, nil)
	if err != nil {
		return FlowResolvedFields{}, fmt.Errorf("flow state machine: load user schema on step %q: %w", step.Name, err)
	}
	resolved, err := r.fields.Resolve(schema, step.Name, step.Fields)
	if err != nil {
		return FlowResolvedFields{}, fmt.Errorf("flow state machine: resolve fields on step %q: %w", step.Name, err)
	}
	return resolved, nil
}

// resolveVisitedFields resolves the union of fields collected by every
// step the user has passed through (history plus current). on_success
// handlers read this to find attributes by challenge across the full
// progress, not just the current step.
func (r *FlowStateMachineRuntime) resolveVisitedFields(pc *processCtx) (FlowResolvedFields, error) {
	ctx, def, state, current := pc.ctx, pc.def, pc.state, pc.currentStep
	seen := map[Field]struct{}{}
	collect := func(s *FlowDefinitionStep) {
		if s == nil {
			return
		}
		for _, f := range s.Fields {
			seen[f] = struct{}{}
		}
	}
	for _, name := range state.History {
		if s, ok := def.FindStep(name); ok {
			collect(s)
		}
	}
	collect(current)
	if len(seen) == 0 {
		return FlowResolvedFields{}, nil
	}
	names := make([]Field, 0, len(seen))
	for n := range seen {
		names = append(names, n)
	}
	schema, err := r.schemas.Resolve(ctx, r.schemaStore, state.ProjectID, state.UserSchemaURL, nil)
	if err != nil {
		return FlowResolvedFields{}, fmt.Errorf("flow state machine: load user schema for visited fields: %w", err)
	}
	resolved, err := r.fields.Resolve(schema, current.Name, names)
	if err != nil {
		return FlowResolvedFields{}, fmt.Errorf("flow state machine: resolve visited fields: %w", err)
	}
	return resolved, nil
}

// buildStep assembles a FlowStep from the raw pieces. Callers without a
// processCtx (Start, renderStep) supply state + step directly; callers
// mid-pipeline pass pc.state + pc.currentStep.
func (r *FlowStateMachineRuntime) buildStep(state *FlowState, step *FlowDefinitionStep, resolved FlowResolvedFields, errorKey *string, complete *FlowStepComplete, redirectURL *string) *FlowStep {
	// Surface only user-selectable actions declared on the step.
	// Implicit outcomes (e.g. user_not_found) live in step.Transitions
	// but are engine-emitted routing keys, not buttons for the client.
	actions := make([]FlowAction, 0, len(step.Actions)+1)
	for _, a := range step.Actions {
		textKey := a.TextKey
		if textKey == "" {
			textKey = step.Name + ".action." + a.Name
		}
		actions = append(actions, FlowAction{
			Name:    a.Name,
			Kind:    a.Kind,
			TextKey: textKey,
			Primary: a.Primary,
		})
	}
	// Inject `back` when there's somewhere to return to. TextKey
	// follows the `<step>.action.<name>` convention.
	if len(state.BackStack) > 0 && step.Complete == nil {
		actions = append(actions, FlowAction{
			Name:    flowBackActionName,
			Kind:    FlowActionKindBack,
			TextKey: step.Name + ".action." + flowBackActionName,
		})
	}
	return &FlowStep{
		Name:         step.Name,
		Texts:        FlowStepTexts{TitleKey: step.Name + ".title", DescriptionKey: step.Name + ".description"},
		Error:        errorKey,
		Complete:     complete,
		RedirectURL:  redirectURL,
		Fields:       resolved.Fields,
		Actions:      actions,
		SSOProviders: nil,
	}
}

// collectsStepFields reports whether a submission commits the step's
// fields to user creation: the submit action, or the passkey-register
// issue leg (no proof yet). These enforce required-field presence; passkey
// login legs and challenge-verify legs send a subset or none.
func collectsStepFields(kind FlowActionKind, in FlowSubmitInput) bool {
	if kind == FlowActionKindSubmit {
		return true
	}
	return kind == FlowActionKindPasskeyRegister && in.ChallengeResponse == nil
}

// stepHasActionKind reports whether the step declares any action of the
// given kind.
func stepHasActionKind(step *FlowDefinitionStep, kind FlowActionKind) bool {
	for _, a := range step.Actions {
		if a.Kind == kind {
			return true
		}
	}
	return false
}

// stepActionKind returns the kind of the step's action with the given name.
// Returns the zero value (unset) when name does not match any action on the
// step — including the empty action submitted by passive POSTs.
func stepActionKind(step *FlowDefinitionStep, actionName string) FlowActionKind {
	if actionName == "" {
		return FlowActionKindUnset
	}
	for _, a := range step.Actions {
		if a.Name == actionName {
			return a.Kind
		}
	}

	// back is not always defined in the step.Actions, it might be auto-injected.
	if actionName == flowBackActionName {
		return FlowActionKindBack
	}

	return FlowActionKindUnset
}

// recordResolvedUser stores the resolved user id; if it changed, any
// state bound to the previous user is cleared.
func recordResolvedUser(state *FlowState, userID string) {
	if state.CollectedData.UserData == nil {
		state.CollectedData.UserData = map[string]any{}
	}
	if state.CollectedData.UserID != userID {
		clearUserBoundState(state)
	}
	state.CollectedData.UserID = userID
}

// clearUserBoundState drops the resolved user id and any in-flight
// ceremony.
func clearUserBoundState(state *FlowState) {
	state.ClearPendingChallenge()
	state.CollectedData.UserID = ""
}

// prefillFromCollected sets FlowField.Value from collectedData for any field
// that doesn't already carry a pre-fill value. This carries identifiers
// (e.g. email entered in a prior step) into subsequent steps that collect the
// same field, so the user doesn't have to retype them.
func prefillFromCollected(resolved *FlowResolvedFields, collected map[string]any) {
	for i := range resolved.Fields {
		if resolved.Fields[i].Value != nil {
			continue
		}
		if v, ok := maputil.GetNested[string](collected, AttributeKey(resolved.Fields[i].Name).Nodes()); ok && v != "" {
			val := v
			resolved.Fields[i].Value = &val
		}
	}
}

func mergeCollected(state *FlowState, fields map[string]any) error {
	if state.CollectedData.UserData == nil {
		state.CollectedData.UserData = map[string]any{}
	}
	if len(fields) == 0 {
		return nil
	}
	for k, v := range fields {
		if strings.HasPrefix(k, authMethodPrefix) {
			switch k {
			case authMethodPrefix + "password":
				pwd, ok := v.(string)
				if !ok {
					return errors.New("password is not a string")
				}
				state.CollectedData.AuthMethods.Password = pwd
				continue
			}
			return fmt.Errorf("unknown auth method %s", k)
		}

		// A field name is an attribute key, so the collected document keeps
		// the shape the user schema validates and the attribute store
		// flattens back out.
		if err := maputil.SetNested(state.CollectedData.UserData, AttributeKey(k).Nodes(), v); err != nil {
			return fmt.Errorf("merge collected field %q: %w", k, err)
		}
	}
	return nil
}

// FindCollectedFieldByChallenge looks up a field whose resolved Challenge
// matches target and whose name is present in collected. Returns the field
// name, the matched [FlowField], and its collected value. Callers that don't
// need the FlowField discard it.
func FindCollectedFieldByChallenge(resolved []FlowField, collected map[string]any, target FlowFieldChallenge) (name string, field FlowField, value any, ok bool) {
	for _, f := range resolved {
		if f.Challenge != target {
			continue
		}
		if v, present := maputil.GetNested[any](collected, AttributeKey(f.Name).Nodes()); present {
			return f.Name, f, v, true
		}
	}
	return "", FlowField{}, nil, false
}
