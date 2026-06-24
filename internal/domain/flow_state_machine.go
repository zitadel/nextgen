package domain

import (
	"context"
	"errors"
	"fmt"
	"strings"
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

var (
	ErrInvalidAction   = errors.New("flow state machine: action not allowed on current step")
	ErrSessionConflict = errors.New("flow state machine: session version conflict")
	ErrIntegrity       = errors.New("flow state machine: integrity violation")
	ErrUnsupported     = errors.New("flow state machine: feature not supported in MVP")
)

// FlowStateMachineRuntime is the production [FlowStateMachine].
type FlowStateMachineRuntime struct {
	schemas             SchemaResolver
	fields              FlowFieldResolver
	createUser          *FlowCreateUserHandler
	authAttempts        FlowAuthAttemptService
	passkeyRegistration FlowPasskeyRegistrationService
	now                 func() time.Time
}

// NewFlowStateMachine wires the runtime. The now hook is injectable so
// tests can produce deterministic [FlowState.IssuedAt] values.
func NewFlowStateMachine(schemas SchemaResolver, fields FlowFieldResolver, createUser *FlowCreateUserHandler, authAttempts FlowAuthAttemptService, passkeyRegistration FlowPasskeyRegistrationService, now func() time.Time) *FlowStateMachineRuntime {
	if now == nil {
		now = time.Now
	}
	return &FlowStateMachineRuntime{schemas: schemas, fields: fields, createUser: createUser, authAttempts: authAttempts, passkeyRegistration: passkeyRegistration, now: now}
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
	// Re-emit an in-flight ceremony so a page reload can resume it.
	attachPendingChallenge(step, state.PendingChallenge)
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
	actionKind := stepActionKind(currentStep, in.Action)

	// Navigate actions skip the entire input pipeline (validation, dispatch,
	// on_success) and route straight to the matching transition. Used for
	// back-navigation and similar pure-routing actions where the submitted
	// fields are irrelevant.
	if actionKind == FlowActionKindNavigate {
		return r.followTransition(ctx, client, def, state, currentStep, in.Action, userSchemaURL)
	}

	resolved, err := r.resolveStepFields(ctx, client, state.ProjectID, userSchemaURL, currentStep)
	if err != nil {
		return FlowStepResult{}, err
	}
	prefillFromCollected(&resolved, state.CollectedData.UserData)

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

	err = mergeCollected(state, in.Fields)
	if err != nil {
		return FlowStepResult{}, fmt.Errorf("flow state machine: validate fields: %w", err)
	}

	routeOutcome := in.Action

	// For passkey Phase 1 (issue challenge, no proof yet), identify the user first
	// so that IssuePasskeyChallenge can populate allowCredentials. Without this,
	// PreparePasskeyChallenge finds no AuthFactorUser and falls back to a discoverable
	// login with an empty allowCredentials list — non-discoverable credentials won't
	// be found by the browser.
	if actionKind == FlowActionKindPasskey && in.ChallengeResponse == nil {
		dispatch, err := r.dispatchChallenges(ctx, def, state, currentStep, resolved, in.Fields)
		if err != nil {
			return FlowStepResult{}, err
		}
		if dispatch.StepError != nil {
			step := r.buildStep(currentStep, resolved, dispatch.StepError, nil, nil)
			state.IssuedAt = r.now()
			return FlowStepResult{State: state, Step: step}, nil
		}
		if dispatch.Outcome != "" {
			// User not found (or similar) — skip the passkey challenge and advance
			// normally (e.g. transition to choose-register).
			routeOutcome = dispatch.Outcome
		}
	}

	// Two-phase passkey ceremony (issue → client signs → verify) runs before the
	// field-shaped dispatch and short-circuits it when engaged. Only proceed into
	// processPasskey when no dispatch outcome already overrode the route.
	if routeOutcome == in.Action {
		pk, err := r.processPasskey(ctx, client, state, currentStep, resolved, in, actionKind)
		if err != nil {
			return FlowStepResult{}, err
		}
		if pk.halt != nil {
			return *pk.halt, nil
		}
		if !pk.handled {
			dispatch, err := r.dispatchChallenges(ctx, def, state, currentStep, resolved, in.Fields)
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
				// Resolve the union of fields collected so far so the handler
				// can read the identifier (and any other attributes) from
				// state.CollectedData rather than only the current step.
				visitedResolved, err := r.resolveVisitedFields(ctx, client, state.ProjectID, userSchemaURL, def, state, currentStep)
				if err != nil {
					return FlowStepResult{}, err
				}
				result, err := r.runOnSuccess(ctx, client, def, state, userSchemaURL, currentStep, in.Fields, visitedResolved)
				if err != nil {
					return FlowStepResult{}, err
				}
				if result.StepError != nil {
					step := r.buildStep(currentStep, resolved, result.StepError, nil, nil)
					state.IssuedAt = r.now()
					return FlowStepResult{State: state, Step: step}, nil
				}
				if result.Outcome != "" {
					routeOutcome = result.Outcome
				}
				if result.UserID != "" {
					recordResolvedUser(state, result.UserID)
					if err := r.authAttempts.RegisterCreatedUser(ctx, FlowRegisterCreatedUserInput{
						ProjectID: state.ProjectID,
						AttemptID: state.AuthAttemptID,
						UserID:    result.UserID,
					}); err != nil {
						return FlowStepResult{}, fmt.Errorf("flow state machine: register created user on attempt: %w", err)
					}
				}
			}
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

	// Flip after the route is committed; an outcome with no wired
	// transition leaves CurrentPurpose untouched.
	applyOutcomeFlip(state, routeOutcome)

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
func (r *FlowStateMachineRuntime) dispatchChallenges(ctx context.Context, def *FlowDefinition, state *FlowState, step *FlowDefinitionStep, resolved FlowResolvedFields, fields map[string]any) (flowDispatchResult, error) {
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
// verification error rendered on the step).
type passkeyPhaseResult struct {
	handled bool
	halt    *FlowStepResult
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
//     was selected → user must already be identified; mint a creation challenge.
func (r *FlowStateMachineRuntime) processPasskey(ctx context.Context, client database.QueryExecutor, state *FlowState, step *FlowDefinitionStep, resolved FlowResolvedFields, in FlowSubmitInput, actionKind FlowActionKind) (passkeyPhaseResult, error) {
	switch {
	// A ceremony is in flight but no proof arrived: resume or abandon.
	case state.PendingChallenge != nil && in.ChallengeResponse == nil:
		if !pendingMatchesKind(state.PendingChallenge.Method, in.Action, actionKind) {
			state.PendingChallenge = nil
			return passkeyPhaseResult{}, nil
		}
		rendered := r.buildStep(step, resolved, nil, nil, nil)
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
			userID := state.CollectedData.UserID
			// Only create the user provisionally when this passkey flow generated
			// the ID (no prior on_success handler already created the user row).
			provisional := state.CollectedData.AuthMethods.HasProvisionedUserIDForPasskey
			if provisional {
				state.CollectedData.AuthMethods.HasProvisionedUserIDForPasskey = false
				if err := r.createUser.HandleProvisional(ctx, client, userID, state, resolved); err != nil {
					return passkeyPhaseResult{}, fmt.Errorf("flow state machine: ensure user exists: %w", err)
				}
			}
			err := r.passkeyRegistration.SubmitPasskeyRegistration(ctx, client, FlowSubmitPasskeyRegistrationInput{
				ProjectID:   state.ProjectID,
				UserID:      userID,
				ChallengeID: challengeID,
				Attestation: in.ChallengeResponse.Proof,
			})
			if errors.Is(err, ErrAuthAttemptProofRejected(nil)) {
				state.PendingChallenge = nil
				msg := "auth_attempt.passkey_registration_invalid"
				rendered := r.buildStep(step, resolved, &msg, nil, nil)
				state.IssuedAt = r.now()
				return passkeyPhaseResult{handled: true, halt: &FlowStepResult{State: state, Step: rendered}}, nil
			}
			if err != nil {
				return passkeyPhaseResult{}, fmt.Errorf("flow state machine: submit passkey registration: %w", err)
			}
			// Only register the created user on the attempt when the passkey
			// flow itself created the user. If an on_success handler already
			// created and registered the user, don't call it again.
			if provisional {
				if err := r.authAttempts.RegisterCreatedUser(ctx, FlowRegisterCreatedUserInput{
					ProjectID: state.ProjectID,
					AttemptID: state.AuthAttemptID,
					UserID:    userID,
				}); err != nil {
					return passkeyPhaseResult{}, fmt.Errorf("flow state machine: register passkey user on attempt: %w", err)
				}
			}
			state.PendingChallenge = nil
			return passkeyPhaseResult{handled: true}, nil

		default: // FlowChallengeMethodPasskey
			userID, err := r.authAttempts.SubmitPasskey(ctx, FlowSubmitPasskeyInput{
				ProjectID:   state.ProjectID,
				AttemptID:   state.AuthAttemptID,
				ChallengeID: challengeID,
				Assertion:   in.ChallengeResponse.Proof,
			})
			if errors.Is(err, ErrAuthAttemptProofRejected(nil)) {
				state.PendingChallenge = nil
				msg := "auth_attempt.passkey_invalid"
				rendered := r.buildStep(step, resolved, &msg, nil, nil)
				state.IssuedAt = r.now()
				return passkeyPhaseResult{handled: true, halt: &FlowStepResult{State: state, Step: rendered}}, nil
			}
			if err != nil {
				return passkeyPhaseResult{}, fmt.Errorf("flow state machine: submit passkey: %w", err)
			}
			recordResolvedUser(state, userID)
			state.PendingChallenge = nil
			return passkeyPhaseResult{handled: true}, nil
		}

	case actionKind == FlowActionKindPasskey:
		if !stepHasActionKind(step, FlowActionKindPasskey) {
			return passkeyPhaseResult{}, nil
		}
		if in.PasskeyRP == nil {
			return passkeyPhaseResult{}, fmt.Errorf("%w: passkey relying-party params missing", ErrIntegrity)
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
		rendered := r.buildStep(step, resolved, nil, nil, nil)
		attachPendingChallenge(rendered, state.PendingChallenge)
		state.IssuedAt = r.now()
		return passkeyPhaseResult{handled: true, halt: &FlowStepResult{State: state, Step: rendered}}, nil

	case actionKind == FlowActionKindPasskeyRegister:
		if !stepHasActionKind(step, FlowActionKindPasskeyRegister) {
			return passkeyPhaseResult{}, nil
		}
		if in.PasskeyRP == nil {
			return passkeyPhaseResult{}, fmt.Errorf("%w: passkey relying-party params missing", ErrIntegrity)
		}
		if r.passkeyRegistration == nil {
			return passkeyPhaseResult{}, fmt.Errorf("%w: passkey registration service not wired", ErrIntegrity)
		}
		userID := state.CollectedData.UserID
		if userID == "" {
			newID, err := r.createUser.GenerateUserID()
			if err != nil {
				return passkeyPhaseResult{}, fmt.Errorf("flow state machine: generate user id: %w", err)
			}
			userID = newID
			state.CollectedData.UserID = userID
			// Mark as provisional: user doesn't exist in the DB yet.
			// The verify leg will call HandleProvisional + RegisterCreatedUser.
			state.CollectedData.AuthMethods.HasProvisionedUserIDForPasskey = true
		}
		out, err := r.passkeyRegistration.IssuePasskeyRegistrationChallenge(ctx, FlowIssuePasskeyRegistrationChallengeInput{
			ProjectID: state.ProjectID,
			UserID:    userID,
			RPID:      in.PasskeyRP.RPID,
			RPOrigins: in.PasskeyRP.Origins,
		})
		if err != nil {
			return passkeyPhaseResult{}, fmt.Errorf("flow state machine: issue passkey registration: %w", err)
		}
		state.PendingChallenge = &FlowPendingChallenge{
			ID:       out.ChallengeID,
			Method:   FlowChallengeMethodPasskeyRegister,
			Options:  out.Options,
			IssuedAt: r.now(),
		}
		rendered := r.buildStep(step, resolved, nil, nil, nil)
		attachPendingChallenge(rendered, state.PendingChallenge)
		state.IssuedAt = r.now()
		return passkeyPhaseResult{handled: true, halt: &FlowStepResult{State: state, Step: rendered}}, nil
	}
	return passkeyPhaseResult{}, nil
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
func (r *FlowStateMachineRuntime) runOnSuccess(ctx context.Context, client database.QueryExecutor, def *FlowDefinition, state *FlowState, userSchemaURL string, step *FlowDefinitionStep, fields map[string]any, resolved FlowResolvedFields) (FlowOnSuccessResult, error) {
	var handler FlowOnSuccessHandler
	switch *step.OnSuccess {
	case FlowOnSuccessCreateUser:
		handler = r.createUser
	}
	if handler == nil {
		return FlowOnSuccessResult{}, fmt.Errorf("%w: on_success %s not wired", ErrIntegrity, *step.OnSuccess)
	}
	return handler.Handle(ctx, client, FlowOnSuccessInput{
		ProjectID:     state.ProjectID,
		UserSchemaURL: userSchemaURL,
		Fields:        fields,
		Resolved:      resolved,
		State:         state,
		ResolvedFlow:  def,
	})
}

// followTransition routes from currentStep via the transition keyed by
// outcome, without running the input pipeline. Used by navigate-kind
// actions (back, etc.) where field validation and dispatch are skipped.
func (r *FlowStateMachineRuntime) followTransition(ctx context.Context, client database.QueryExecutor, def *FlowDefinition, state *FlowState, currentStep *FlowDefinitionStep, outcome, userSchemaURL string) (FlowStepResult, error) {
	transition, ok := currentStep.Transitions[outcome]
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: %q on step %q", ErrInvalidAction, outcome, currentStep.Name)
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

	// Skip handoff when no user was resolved (e.g. user_not_found →
	// no-account). PrepareHandoff can't catch this today: attempts are
	// started with empty RequiredChecks, so IsCompleted is vacuously
	// true and a token would be minted. Remove once the policy engine
	// populates RequiredChecks.
	if state.CollectedData.UserID == "" {
		return rendered, FlowHandoffOutput{}, nil
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
	prefillFromCollected(&resolved, state.CollectedData.UserData)
	return r.buildStep(step, resolved, nil, nil, nil), nil
}

func (r *FlowStateMachineRuntime) resolveStepFields(ctx context.Context, client database.QueryExecutor, projectID, userSchemaURL string, step *FlowDefinitionStep) (FlowResolvedFields, error) {
	if len(step.Fields) == 0 {
		return FlowResolvedFields{}, nil
	}
	schema, err := r.schemas.Resolve(ctx, client, projectID, userSchemaURL, nil)
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
func (r *FlowStateMachineRuntime) resolveVisitedFields(ctx context.Context, client database.QueryExecutor, projectID, userSchemaURL string, def *FlowDefinition, state *FlowState, current *FlowDefinitionStep) (FlowResolvedFields, error) {
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
	schema, err := r.schemas.Resolve(ctx, client, projectID, userSchemaURL, nil)
	if err != nil {
		return FlowResolvedFields{}, fmt.Errorf("flow state machine: load user schema for visited fields: %w", err)
	}
	resolved, err := r.fields.Resolve(schema, current.Name, names)
	if err != nil {
		return FlowResolvedFields{}, fmt.Errorf("flow state machine: resolve visited fields: %w", err)
	}
	return resolved, nil
}

func (r *FlowStateMachineRuntime) buildStep(step *FlowDefinitionStep, resolved FlowResolvedFields, errorKey *string, complete *FlowStepComplete, redirectURL *string) *FlowStep {
	// Surface only user-selectable actions declared on the step.
	// Implicit outcomes (e.g. user_not_found) live in step.Transitions
	// but are engine-emitted routing keys, not buttons for the client.
	actions := make([]FlowAction, len(step.Actions))
	for i, a := range step.Actions {
		textKey := a.TextKey
		if textKey == "" {
			textKey = step.Name + ".action." + a.Name
		}
		actions[i] = FlowAction{
			Name:    a.Name,
			Kind:    a.Kind,
			TextKey: textKey,
			Primary: a.Primary,
		}
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
func stepActionKind(step *FlowDefinitionStep, name string) FlowActionKind {
	if name == "" {
		return 0
	}
	for _, a := range step.Actions {
		if a.Name == name {
			return a.Kind
		}
	}
	return 0
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

// clearUserBoundState drops the resolved user id, any in-flight
// ceremony, and the passkey provisional marker.
func clearUserBoundState(state *FlowState) {
	state.PendingChallenge = nil
	state.CollectedData.UserID = ""
	state.CollectedData.AuthMethods.HasProvisionedUserIDForPasskey = false
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
		if v, ok := collected[resolved.Fields[i].Name].(string); ok && v != "" {
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
		if strings.HasPrefix(k, "x-auth-methods#") {
			switch k {
			case "x-auth-methods#password":
				pwd, ok := v.(string)
				if !ok {
					return errors.New("password is not a string")
				}
				state.CollectedData.AuthMethods.Password = pwd
				continue
			}
			return fmt.Errorf("unknown auth method %s", k)
		}

		state.CollectedData.UserData[k] = v
	}
	return nil
}

func asValidationErrors(err error, out *FlowFieldValidationErrors) bool {
	if errs, ok := err.(FlowFieldValidationErrors); ok {
		*out = errs
		return true
	}
	return false
}
