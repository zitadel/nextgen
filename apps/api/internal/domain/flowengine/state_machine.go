package flowengine

import (
	"context"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/crypto/pow"
	"github.com/zitadel/nextgen/internal/domain"
)

// Step error text keys the state machine emits when an auth-attempt
// proof is rejected. Every engine-emitted step error must be a
// localizable `error.*` catalog key: /login localizes only
// `error.*`-prefixed step errors, so anything else renders verbatim (see
// `localiseFlowErrorKeys` in
// packages/components/src/orchestrator/liquid.ts). New emission sites
// add a const here; TestFlowStepErrorContract keeps the set honest.
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
	// FlowStepErrorSSOCreationDisabled reports a provider identity with no
	// account on a connection whose provisioning.creation is disabled.
	FlowStepErrorSSOCreationDisabled = "error.sso_creation_disabled"
	// FlowStepErrorSSOUnavailable reports a provider the engine could not
	// start a sign-in with, or whose sign-in the current step cannot route.
	// The user stays on the step.
	FlowStepErrorSSOUnavailable = "error.sso_unavailable"
	// FlowStepErrorSSOCancelled reports a provider callback carrying
	// access_denied (RFC 6749 §4.1.2.1): the person declined at the provider,
	// or it refused the request. The one provider error with its own key,
	// because telling someone the sign-in failed when they cancelled it sends
	// them hunting for a mistake they never made.
	FlowStepErrorSSOCancelled = "error.sso_cancelled"
	// FlowStepErrorSSOFailed reports every other failure after the provider
	// redirected back: another provider error code, a failed code exchange or
	// id_token validation, or a configuration failure. The cause goes to the
	// server log only; the step error stays generic.
	FlowStepErrorSSOFailed = "error.sso_failed"
	// FlowStepErrorSSOVerifiedUniqueValueChanged reports an edit, on the
	// collection step, to a unique value the provider verified. Linking the
	// identity to an edited, unproven address would let the editor take it.
	FlowStepErrorSSOVerifiedUniqueValueChanged = "error.sso_verified_unique_value_changed"
	// FlowStepErrorSSOUserInvalid reports values that fail the user schema
	// only together, such as a rule across fields. The user can still edit
	// them on the step.
	FlowStepErrorSSOUserInvalid = "error.sso_user_invalid"
	// FlowStepErrorSSOUserCannotBeCreated reports what no edit on the step
	// can fix: a required property that neither the step nor the provider
	// supplies, which the flow definition must collect, or a verified unique
	// claim the user schema rejects, which the schema must accept.
	FlowStepErrorSSOUserCannotBeCreated = "error.sso_user_cannot_be_created"
	// FlowStepErrorUserAlreadyExists reports a unique value another user
	// holds where the engine cannot bind that user, so it cannot route
	// user_already_exists: a user of another schema. Also what an unwired
	// user_already_exists outcome renders.
	FlowStepErrorUserAlreadyExists = "error.user_already_exists"
	// FlowStepErrorUserNotFound reports an unknown identifier on a step
	// that does not wire user_not_found.
	FlowStepErrorUserNotFound = "error.user_not_found"
	// FlowStepErrorSSOUserNotFound reports a provider identity with no
	// account on a step that does not wire sso_user_not_found.
	FlowStepErrorSSOUserNotFound = "error.sso_user_not_found"
	// FlowStepErrorOutcomeUnhandled reports an unwired outcome with no
	// key of its own.
	FlowStepErrorOutcomeUnhandled = "error.outcome_unhandled"
	// FlowStepErrorSignInFirst reports a password submitted on a sign-in
	// step that has no user to check it against, such as a conflict step
	// reached without binding the colliding user. The password is
	// discarded; the user has to sign in from the start. The key avoids the
	// `error.<field>_<rule>` shape so it cannot read as a field's validation
	// error.
	FlowStepErrorSignInFirst = "error.sign_in_first"
)

// unwiredOutcomeErrors maps an implicit outcome the current step does not
// route to the step error it renders instead.
var unwiredOutcomeErrors = map[string]string{
	domain.FlowImplicitOutcomeUserNotFound:      FlowStepErrorUserNotFound,
	domain.FlowImplicitOutcomeUserAlreadyExists: FlowStepErrorUserAlreadyExists,
	domain.FlowImplicitOutcomeSSOUserNotFound:   FlowStepErrorSSOUserNotFound,
}

// UnwiredOutcomeError returns the step error an unwired outcome renders.
func UnwiredOutcomeError(outcome string) string {
	if key, ok := unwiredOutcomeErrors[outcome]; ok {
		return key
	}
	return FlowStepErrorOutcomeUnhandled
}

// Step notice text keys: why the engine moved the flow to another purpose
// without the user asking, carried on the step it lands on. Like step
// errors, they are `notice.*` catalog keys the client localizes.
const (
	// FlowStepNoticeUserNotFound tells a user whose identifier has no
	// account that the sign-in continues as a sign-up.
	FlowStepNoticeUserNotFound = "notice.user_not_found"
	// FlowStepNoticeUserAlreadyExists tells a user signing up with an
	// identifier that has an account that the flow continues as a sign-in.
	FlowStepNoticeUserAlreadyExists = "notice.user_already_exists"
	// FlowStepNoticeSSOUserNotFound tells a user whose provider sign-in has
	// no account that the sign-in continues as a sign-up.
	FlowStepNoticeSSOUserNotFound = "notice.sso_user_not_found"
)

// purposeChangeNotices maps an implicit outcome that can move the flow to
// another purpose to the notice the step it lands on carries.
var purposeChangeNotices = map[string]string{
	domain.FlowImplicitOutcomeUserNotFound:      FlowStepNoticeUserNotFound,
	domain.FlowImplicitOutcomeUserAlreadyExists: FlowStepNoticeUserAlreadyExists,
	domain.FlowImplicitOutcomeSSOUserNotFound:   FlowStepNoticeSSOUserNotFound,
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
	Process(ctx context.Context, def *domain.FlowDefinition, state *domain.FlowState, in FlowSubmitInput) (FlowStepResult, error)
	// Render re-emits the current step without advancing. Backs GET /flows/{flow_id}.
	Render(ctx context.Context, def *domain.FlowDefinition, state *domain.FlowState) (FlowStepResult, error)
}

// FlowStartInput carries everything the state machine needs to
// bootstrap a new flow.
type FlowStartInput struct {
	// ID is the flow handle the caller minted. The attempt the flow creates
	// records it, so the handoff exchange's events join the flow's.
	ID            string
	Definition    *domain.FlowDefinition
	Purpose       domain.FlowDefinitionPurpose
	Session       FlowSessionRef
	AuthRequest   *FlowAuthRequestRef
	RedirectURI   *string
	UserSchemaURL string
}

// FlowSubmitInput carries a single client submission.
//
// GateProofs carries the built-in signup proof to the submissions that can
// create a user: create_user, and a passkey registration's attestation. Any
// other submission to a step carrying that registration may bring it too and
// leaves it unspent, since the step announces the gate. Other gate names, or
// proofs on any other step, remain unsupported.
type FlowSubmitInput struct {
	Action     string
	Fields     map[string]any
	GateProofs map[string]string
	// SSOProvider names the provider the user picked. Read only with
	// [domain.FlowActionSSO]; on any other action it is an invalid submission.
	SSOProvider *FlowSSOProviderRef
	// SSOReturn carries the callback route and the return page the API
	// derived from the request. Required on an sso submission.
	SSOReturn *domain.FlowSSOReturn
	// ChallengeResponse carries the client's answer to a pending ceremony
	// (e.g. a passkey assertion). Present on the verify leg of a two-phase
	// challenge; nil otherwise.
	ChallengeResponse *FlowChallengeResponse
	// PasskeyRP carries the WebAuthn relying-party parameters the API
	// derived from the request. Required on the passkey issue leg.
	PasskeyRP *FlowPasskeyRP
}

// FlowChallengeResponse is the client's answer to a [domain.FlowPendingChallenge].
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
// + HandoffTokenExpiresAt are populated only on the terminal step;
// SSOBindingNonce only on the [FlowStepNameSSORedirect] step, where the
// handler sets it as the browser-binding cookie. Reseal is set only by
// [Render], when resolving a parked SSO identity changed the state: the
// handler re-seals only such a render.
type FlowStepResult struct {
	State                 *domain.FlowState
	Step                  *FlowStep
	Pop                   bool
	HandoffToken          string
	HandoffTokenExpiresAt time.Time
	SSOBindingNonce       string
	Reseal                bool
}

// FlowStep is the capability payload the API surfaces to the client.
// It mirrors the OpenAPI `flow-step` component in domain terms.
type FlowStep struct {
	SignupRequired  bool
	SignupChallenge *pow.PublicChallenge
	Name            string
	Texts           FlowStepTexts
	// Purpose is what the flow does on this step, the state's
	// CurrentPurpose: a client tells a sign-in from a sign-up by it, since
	// step names are the definition's to choose.
	Purpose domain.FlowDefinitionPurpose
	// Notice is a `notice.*` key saying why an implicit outcome moved the
	// flow to Purpose. Set only on the step that move renders.
	Notice *string
	Error  *string
	// Failure is the cause of Error, for the API error line only: never
	// sent, never stored.
	Failure      *domain.FlowStepFailure
	Complete     *domain.FlowStepComplete
	RedirectURL  *string
	Fields       []domain.FlowField
	Actions      []FlowAction
	SSOProviders []domain.FlowSSOProvider
	// Identifier is set only when the step collects a password without
	// collecting the identifier. Render-only — see [FlowStepIdentifier].
	Identifier *FlowStepIdentifier
	// Challenge is a pending authentication ceremony the client must
	// satisfy before re-submitting (e.g. a passkey assertion). Nil unless
	// the engine just issued one.
	Challenge *FlowStepChallenge
}

// FlowStepIdentifier mirrors the OpenAPI `flow-step.identifier`: the
// identifier a password form carries as a hidden control, so a password
// manager stores the two as one credential. It carries no field name — the
// control the client renders has none, so it is never submitted.
type FlowStepIdentifier struct {
	Value        string
	Autocomplete string
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
	Kind    domain.FlowActionKind
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

// FlowStepNameSSORedirect is the engine-emitted step that carries the
// provider's authorize URL. The flow state stays on the step the user
// picked the provider from; the callback moves it on.
const FlowStepNameSSORedirect = "sso-redirect"

// flowSSORedirectTitleKey is the step's only text; the client shows it
// while the browser navigates to the provider.
const flowSSORedirectTitleKey = "sso.redirect.title"

// FlowChallengeMethodPasskey is the [FlowStepChallenge.Method] /
// [domain.FlowPendingChallenge.Method] value for the WebAuthn passkey ceremony.
const FlowChallengeMethodPasskey = "passkey"

// FlowChallengeMethodPasskeyRegister is the [FlowStepChallenge.Method] /
// [domain.FlowPendingChallenge.Method] value for the WebAuthn registration ceremony.
const FlowChallengeMethodPasskeyRegister = "passkey_register"

// flowPasskeyDefaultUserVerification is the WebAuthn user-verification
// requirement used when issuing a passkey challenge from a flow. The RP
// origin/id come from the request; user verification is defaulted.
const flowPasskeyDefaultUserVerification = "preferred"

// FlowSessionRef pins the session row this flow runs on top of. A
// version mismatch surfaces as [domain.ErrFlowSessionConflict].
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
	schemas       domain.SchemaResolver
	schemaStore   domain.JSONSchemaStore
	fields        domain.FlowFieldResolver
	userCreater   domain.FlowOnSuccessHandler
	authAttempts  domain.FlowAuthAttemptService
	ssoProviders  domain.FlowSSOProviderResolver
	ssoIdentities domain.FlowSSOIdentityService
	ssoRedirects  domain.FlowSSORedirectIssuer
	passwords     domain.FlowPasswordPolicy
	now           func() time.Time
}

// FlowStateMachineDeps are the services the runtime calls. Now is injectable
// so tests can produce deterministic [domain.FlowState.IssuedAt] values; nil
// means [time.Now].
type FlowStateMachineDeps struct {
	Schemas       domain.SchemaResolver
	SchemaStore   domain.JSONSchemaStore
	Fields        domain.FlowFieldResolver
	CreateUser    domain.FlowOnSuccessHandler
	AuthAttempts  domain.FlowAuthAttemptService
	SSOProviders  domain.FlowSSOProviderResolver
	SSOIdentities domain.FlowSSOIdentityService
	SSORedirects  domain.FlowSSORedirectIssuer
	Passwords     domain.FlowPasswordPolicy
	Now           func() time.Time
}

// NewFlowStateMachine wires the runtime.
func NewFlowStateMachine(deps FlowStateMachineDeps) *FlowStateMachineRuntime {
	now := deps.Now
	if now == nil {
		now = time.Now
	}
	return &FlowStateMachineRuntime{
		schemas:       deps.Schemas,
		schemaStore:   deps.SchemaStore,
		fields:        deps.Fields,
		userCreater:   deps.CreateUser,
		authAttempts:  deps.AuthAttempts,
		ssoProviders:  deps.SSOProviders,
		ssoIdentities: deps.SSOIdentities,
		ssoRedirects:  deps.SSORedirects,
		passwords:     deps.Passwords,
		now:           now,
	}
}

var _ FlowStateMachine = (*FlowStateMachineRuntime)(nil)

func (r *FlowStateMachineRuntime) Start(ctx context.Context, in FlowStartInput) (FlowStepResult, error) {
	if in.Definition == nil {
		return FlowStepResult{}, fmt.Errorf("%w: start without definition", domain.ErrFlowIntegrity())
	}
	initialStepName, ok := in.Definition.InitialStepFor(in.Purpose)
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: definition %q does not serve purpose %s", domain.ErrFlowIntegrity(), in.Definition.ID, in.Purpose)
	}

	state := &domain.FlowState{
		ID:            in.ID,
		ProjectID:     in.Definition.ProjectID,
		UserSchemaURL: in.UserSchemaURL,
		FlowProgress: domain.FlowProgress{
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
		return FlowStepResult{}, fmt.Errorf("%w: auth-attempt service not wired", domain.ErrFlowIntegrity())
	}
	attemptInput := domain.FlowCreateAttemptInput{ProjectID: state.ProjectID, FlowID: state.ID}
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

// processCtx carries the per-submission context threaded through the
// action kind handlers and their helpers.
type processCtx struct {
	ctx         context.Context
	def         *domain.FlowDefinition
	state       *domain.FlowState
	currentStep *domain.FlowDefinitionStep
	in          FlowSubmitInput
}

// Process advances the flow one step by dispatching the submission to
// the handler for its action kind (see [actionKindHandlers]).
func (r *FlowStateMachineRuntime) Process(ctx context.Context, def *domain.FlowDefinition, state *domain.FlowState, in FlowSubmitInput) (FlowStepResult, error) {
	if def == nil || state == nil {
		return FlowStepResult{}, fmt.Errorf("%w: process without definition or state", domain.ErrFlowIntegrity())
	}

	currentStep, ok := def.FindStep(state.CurrentStep)
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: current step %q missing from definition", domain.ErrFlowIntegrity(), state.CurrentStep)
	}

	for name := range in.GateProofs {
		if name != domain.SignupGate || !acceptsSignupProof(currentStep, state, in) {
			return FlowStepResult{}, fmt.Errorf("%w: gate proofs", domain.ErrFlowUnsupported())
		}
	}
	pc := &processCtx{ctx: ctx, def: def, state: state, currentStep: currentStep, in: in}
	// An external sign-in collects nothing on the step, so it skips the
	// input pipeline like back and navigate do.
	if in.Action == domain.FlowActionSSO || in.SSOProvider != nil {
		return r.processSSO(pc)
	}
	handler, ok := actionKindHandlers[stepActionKind(currentStep, in.Action)]
	// Only an action the step declares can be submitted. The outcome names
	// (user_not_found, sso_authenticated, ...) are routed by the engine
	// alone; a client naming one would otherwise take that route.
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: %q on step %q", domain.ErrFlowInvalidAction(), in.Action, currentStep.Name)
	}
	return handler.process(r, pc)
}

// submitHandler handles kind=submit: collect the step's fields, dispatch
// challenges, run on_success (if declared), and route the resulting outcome.
type submitHandler struct{}

func (submitHandler) process(r *FlowStateMachineRuntime, pc *processCtx) (FlowStepResult, error) {
	resolved, halt, err := r.takeInputs(pc, stepInputs{collectsStepFields: true})
	if err != nil {
		return FlowStepResult{}, err
	}
	if halt != nil {
		return *halt, nil
	}
	// The step's values describe the provider's identity, not a sign-in, so
	// its identifier is never submitted as one.
	if !pc.currentStep.OnSuccessSpec().ProviderIdentity {
		dispatch, err := r.dispatchChallenges(pc, resolved)
		if err != nil {
			return FlowStepResult{}, err
		}
		if dispatch.StepError != nil {
			return r.renderStepError(pc, resolved, dispatch.StepError)
		}
		if dispatch.Outcome != "" {
			return r.routeOutcome(pc, resolved, dispatch.Outcome, false)
		}
	}
	if pc.currentStep.OnSuccess == nil {
		return r.routeOutcome(pc, resolved, pc.in.Action, false)
	}
	handler, ok := onSuccessHandlers[*pc.currentStep.OnSuccess]
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: on_success %s not wired", domain.ErrFlowIntegrity(), *pc.currentStep.OnSuccess)
	}
	return handler.run(r, pc, resolved)
}

func (submitHandler) acceptsSignupProof(*domain.FlowState, FlowSubmitInput) bool { return false }

// recordResolvedUser stores the resolved user id; if it changed, any
// state bound to the previous user is cleared.
func recordResolvedUser(state *domain.FlowState, userID string) {
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
func clearUserBoundState(state *domain.FlowState) {
	state.ClearPendingChallenge()
	state.CollectedData.UserID = ""
	state.CollectedData.SSOConflictConnectionID = ""
}
