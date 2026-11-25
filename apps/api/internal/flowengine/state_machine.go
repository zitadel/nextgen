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
	// StepErrorInvalidCredentials reports a rejected password
	// proof. The client routes it inline to the password field
	// (fieldErrorKeys in liquid.ts).
	StepErrorInvalidCredentials = "error.invalid_credentials"
	// StepErrorPasskeyInvalid reports a rejected passkey assertion.
	StepErrorPasskeyInvalid = "error.passkey_invalid"
	// StepErrorPasskeyRegistrationInvalid reports a rejected
	// passkey registration attestation.
	StepErrorPasskeyRegistrationInvalid = "error.passkey_registration_invalid"
	// StepErrorSSOCreationDisabled reports a provider identity with no
	// account on a connection whose provisioning.creation is disabled.
	StepErrorSSOCreationDisabled = "error.sso_creation_disabled"
	// StepErrorSSOUnavailable reports a provider the engine could not
	// start a sign-in with, or whose sign-in the current step cannot route.
	// The user stays on the step.
	StepErrorSSOUnavailable = "error.sso_unavailable"
	// StepErrorSSOCancelled reports a provider callback carrying
	// access_denied (RFC 6749 §4.1.2.1): the person declined at the provider,
	// or it refused the request. The one provider error with its own key,
	// because telling someone the sign-in failed when they cancelled it sends
	// them hunting for a mistake they never made.
	StepErrorSSOCancelled = "error.sso_cancelled"
	// StepErrorSSOFailed reports every other failure after the provider
	// redirected back: another provider error code, a failed code exchange or
	// id_token validation, or a configuration failure. The cause goes to the
	// server log only; the step error stays generic.
	StepErrorSSOFailed = "error.sso_failed"
	// StepErrorSSOVerifiedUniqueValueChanged reports an edit, on the
	// collection step, to a unique value the provider verified. Linking the
	// identity to an edited, unproven address would let the editor take it.
	StepErrorSSOVerifiedUniqueValueChanged = "error.sso_verified_unique_value_changed"
	// StepErrorSSOUserInvalid reports values that fail the user schema
	// only together, such as a rule across fields. The user can still edit
	// them on the step.
	StepErrorSSOUserInvalid = "error.sso_user_invalid"
	// StepErrorSSOUserCannotBeCreated reports what no edit on the step
	// can fix: a required property that neither the step nor the provider
	// supplies, which the flow definition must collect, or a verified unique
	// claim the user schema rejects, which the schema must accept.
	StepErrorSSOUserCannotBeCreated = "error.sso_user_cannot_be_created"
	// StepErrorUserAlreadyExists reports a unique value another user
	// holds where the engine cannot bind that user, so it cannot route
	// user_already_exists: a user of another schema. Also what an unwired
	// user_already_exists outcome renders.
	StepErrorUserAlreadyExists = "error.user_already_exists"
	// StepErrorUserNotFound reports an unknown identifier on a step
	// that does not wire user_not_found.
	StepErrorUserNotFound = "error.user_not_found"
	// StepErrorSSOUserNotFound reports a provider identity with no
	// account on a step that does not wire sso_user_not_found.
	StepErrorSSOUserNotFound = "error.sso_user_not_found"
	// StepErrorOutcomeUnhandled reports an unwired outcome with no
	// key of its own.
	StepErrorOutcomeUnhandled = "error.outcome_unhandled"
	// StepErrorSignInFirst reports a password submitted on a sign-in
	// step that has no user to check it against, such as a conflict step
	// reached without binding the colliding user. The password is
	// discarded; the user has to sign in from the start. The key avoids the
	// `error.<field>_<rule>` shape so it cannot read as a field's validation
	// error.
	StepErrorSignInFirst = "error.sign_in_first"
)

// unwiredOutcomeErrors maps an implicit outcome the current step does not
// route to the step error it renders instead.
var unwiredOutcomeErrors = map[string]string{
	domain.FlowImplicitOutcomeUserNotFound:      StepErrorUserNotFound,
	domain.FlowImplicitOutcomeUserAlreadyExists: StepErrorUserAlreadyExists,
	domain.FlowImplicitOutcomeSSOUserNotFound:   StepErrorSSOUserNotFound,
}

// UnwiredOutcomeError returns the step error an unwired outcome renders.
func UnwiredOutcomeError(outcome string) string {
	if key, ok := unwiredOutcomeErrors[outcome]; ok {
		return key
	}
	return StepErrorOutcomeUnhandled
}

// Step notice text keys: why the engine moved the flow to another purpose
// without the user asking, carried on the step it lands on. Like step
// errors, they are `notice.*` catalog keys the client localizes.
const (
	// StepNoticeUserNotFound tells a user whose identifier has no
	// account that the sign-in continues as a sign-up.
	StepNoticeUserNotFound = "notice.user_not_found"
	// StepNoticeUserAlreadyExists tells a user signing up with an
	// identifier that has an account that the flow continues as a sign-in.
	StepNoticeUserAlreadyExists = "notice.user_already_exists"
	// StepNoticeSSOUserNotFound tells a user whose provider sign-in has
	// no account that the sign-in continues as a sign-up.
	StepNoticeSSOUserNotFound = "notice.sso_user_not_found"
)

// purposeChangeNotices maps an implicit outcome that can move the flow to
// another purpose to the notice the step it lands on carries.
var purposeChangeNotices = map[string]string{
	domain.FlowImplicitOutcomeUserNotFound:      StepNoticeUserNotFound,
	domain.FlowImplicitOutcomeUserAlreadyExists: StepNoticeUserAlreadyExists,
	domain.FlowImplicitOutcomeSSOUserNotFound:   StepNoticeSSOUserNotFound,
}

// StateMachine drives a flow definition forward in response to
// client submissions. The handler owns cookie I/O; the state machine
// never touches cookies.
//
// MVP scope: single linear flow per `flow_id`, no pivot stack, no
// challenges, no gates. `Pop` on [StepResult] stays reserved for
// the deferred pivot work.
type StateMachine interface {
	Start(ctx context.Context, in StartInput) (StepResult, error)
	// Process and Render read the flow's definition through
	// [ActiveDefinition] on defs.
	Process(ctx context.Context, defs Definitions, state *State, in SubmitInput) (StepResult, error)
	// Render re-emits the current step without advancing. Backs GET /flows/{flow_id}.
	Render(ctx context.Context, defs Definitions, state *State) (StepResult, error)
}

// StartInput carries everything the state machine needs to
// bootstrap a new flow.
type StartInput struct {
	// ID is the flow handle the caller minted. The attempt the flow creates
	// records it, so the handoff exchange's events join the flow's.
	ID string
	// Definition is the flow's entry definition. The state Start returns
	// names it, and later requests read it through [ActiveDefinition].
	Definition    *domain.FlowDefinition
	Purpose       domain.FlowDefinitionPurpose
	Session       SessionRef
	AuthRequest   *AuthRequestRef
	RedirectURI   *string
	UserSchemaURL string
	// DeploymentID and ReleaseID are what the request resolved to; the state
	// keeps them for every later request of the flow.
	DeploymentID string
	ReleaseID    string
}

// SubmitInput carries a single client submission.
//
// GateProofs carries the built-in signup proof to the submissions that can
// create a user: create_user, and a passkey registration's attestation. Any
// other submission to a step carrying that registration may bring it too and
// leaves it unspent, since the step announces the gate. Other gate names, or
// proofs on any other step, remain unsupported.
type SubmitInput struct {
	Action     string
	Fields     map[string]any
	GateProofs map[string]string
	// SSOProvider names the provider the user picked. Read only with
	// [domain.FlowActionSSO]; on any other action it is an invalid submission.
	SSOProvider *SSOProviderRef
	// SSOReturn carries the callback route and the return page the API
	// derived from the request. Required on an sso submission.
	SSOReturn *domain.FlowSSOReturn
	// ChallengeResponse carries the client's answer to a pending ceremony
	// (e.g. a passkey assertion). Present on the verify leg of a two-phase
	// challenge; nil otherwise.
	ChallengeResponse *ChallengeResponse
	// PasskeyRP carries the WebAuthn relying-party parameters the API
	// derived from the request. Required on the passkey issue leg.
	PasskeyRP *PasskeyRP
}

// ChallengeResponse is the client's answer to a [PendingChallenge].
type ChallengeResponse struct {
	ChallengeID string
	Method      string
	// Proof is the method-specific payload (for passkey, the WebAuthn
	// PublicKeyCredential assertion JSON).
	Proof []byte
}

// PasskeyRP is the relying-party context for issuing a passkey
// challenge, derived from the HTTP request at the API edge.
type PasskeyRP struct {
	RPID    string
	Origins []string
}

type SSOProviderRef struct {
	ID string
}

// StepResult is what the state machine returns from [Start] and
// [Process]. Pop is reserved for the deferred pivot stack. HandoffToken
// + HandoffTokenExpiresAt are populated only on the terminal step;
// SSOBindingNonce only on the [StepNameSSORedirect] step, where the
// handler sets it as the browser-binding cookie. Reseal is set only by
// [Render], when resolving a parked SSO identity changed the state: the
// handler re-seals only such a render.
type StepResult struct {
	State                 *State
	Step                  *Step
	Pop                   bool
	HandoffToken          string
	HandoffTokenExpiresAt time.Time
	SSOBindingNonce       string
	Reseal                bool
}

// Step is the capability payload the API surfaces to the client.
// It mirrors the OpenAPI `flow-step` component in domain terms.
type Step struct {
	SignupRequired  bool
	SignupChallenge *pow.PublicChallenge
	Name            string
	Texts           StepTexts
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
	Actions      []StepAction
	SSOProviders []domain.FlowSSOProvider
	// Identifier is set only when the step collects a password without
	// collecting the identifier. Render-only — see [StepIdentifier].
	Identifier *StepIdentifier
	// Challenge is a pending authentication ceremony the client must
	// satisfy before re-submitting (e.g. a passkey assertion). Nil unless
	// the engine just issued one.
	Challenge *StepChallenge
}

// StepIdentifier mirrors the OpenAPI `flow-step.identifier`: the
// identifier a password form carries as a hidden control, so a password
// manager stores the two as one credential. It carries no field name — the
// control the client renders has none, so it is never submitted.
type StepIdentifier struct {
	Value        string
	Autocomplete string
}

// StepChallenge mirrors the OpenAPI `flow-step.challenge`: a pending
// ceremony the client runs (passkey today) before re-submitting the proof.
type StepChallenge struct {
	Method      string
	ChallengeID string
	// Options is the protocol-specific options JSON the client passes to
	// the ceremony API (for passkey, PublicKeyCredentialRequestOptions).
	Options []byte
}

// StepTexts holds the step-level localization keys (`<step>.title`,
// `<step>.description`) the template resolves via the `| t` filter.
type StepTexts struct {
	TitleKey       string
	DescriptionKey string
}

// StepAction is a single user action surfaced on [Step.Actions].
type StepAction struct {
	Name    string
	Kind    domain.FlowActionKind
	TextKey string
	Primary bool
}

// ActionSubmit is the conventional outcome name for the primary
// "advance forward" action on a step.
const ActionSubmit = "submit"

// ActionPasskey is the action a step declares to offer passkey
// authentication. Selecting it issues a WebAuthn challenge; the matching
// transition fires once the returned assertion verifies.
const ActionPasskey = "passkey"

// ActionPasskeyRegister is the action a step declares to offer passkey
// enrollment. Selecting it issues a registration challenge; the matching
// transition fires once the returned attestation verifies.
const ActionPasskeyRegister = "passkey_register"

// StepNameSSORedirect is the engine-emitted step that carries the
// provider's authorize URL. The flow state stays on the step the user
// picked the provider from; the callback moves it on.
const StepNameSSORedirect = "sso-redirect"

// ssoRedirectTitleKey is the step's only text; the client shows it
// while the browser navigates to the provider.
const ssoRedirectTitleKey = "sso.redirect.title"

// ChallengeMethodPasskey is the [StepChallenge.Method] /
// [PendingChallenge.Method] value for the WebAuthn passkey ceremony.
const ChallengeMethodPasskey = "passkey"

// ChallengeMethodPasskeyRegister is the [StepChallenge.Method] /
// [PendingChallenge.Method] value for the WebAuthn registration ceremony.
const ChallengeMethodPasskeyRegister = "passkey_register"

// passkeyDefaultUserVerification is the WebAuthn user-verification
// requirement used when issuing a passkey challenge from a flow. The RP
// origin/id come from the request; user verification is defaulted.
const passkeyDefaultUserVerification = "preferred"

// SessionRef pins the session row this flow runs on top of. A
// version mismatch surfaces as [domain.ErrFlowSessionConflict].
type SessionRef struct {
	ID      string
	Version int64
}

// AuthRequestRef ties a flow to the OIDC authorization request it
// is fulfilling.
type AuthRequestRef struct {
	ID           string
	RequestedACR *string
}

// Runtime is the production [StateMachine].
type Runtime struct {
	schemas       domain.SchemaResolver
	schemaStore   domain.JSONSchemaStore
	fields        domain.FlowFieldResolver
	userCreater   OnSuccessHandler
	authAttempts  AuthAttemptService
	ssoProviders  SSOProviderResolver
	ssoIdentities SSOIdentityService
	ssoRedirects  SSORedirectIssuer
	passwords     PasswordPolicy
	completion    CompletionPolicy
	now           func() time.Time
}

// Deps are the services the runtime calls. Now is injectable
// so tests can produce deterministic [State.IssuedAt] values; nil
// means [time.Now]. A nil Completion lets every flow complete.
type Deps struct {
	Schemas       domain.SchemaResolver
	SchemaStore   domain.JSONSchemaStore
	Fields        domain.FlowFieldResolver
	CreateUser    OnSuccessHandler
	AuthAttempts  AuthAttemptService
	SSOProviders  SSOProviderResolver
	SSOIdentities SSOIdentityService
	SSORedirects  SSORedirectIssuer
	Passwords     PasswordPolicy
	Completion    CompletionPolicy
	Now           func() time.Time
}

// New wires the runtime.
func New(deps Deps) *Runtime {
	now := deps.Now
	if now == nil {
		now = time.Now
	}
	return &Runtime{
		schemas:       deps.Schemas,
		schemaStore:   deps.SchemaStore,
		fields:        deps.Fields,
		userCreater:   deps.CreateUser,
		authAttempts:  deps.AuthAttempts,
		ssoProviders:  deps.SSOProviders,
		ssoIdentities: deps.SSOIdentities,
		ssoRedirects:  deps.SSORedirects,
		passwords:     deps.Passwords,
		completion:    deps.Completion,
		now:           now,
	}
}

var _ StateMachine = (*Runtime)(nil)

func (r *Runtime) Start(ctx context.Context, in StartInput) (StepResult, error) {
	if in.Definition == nil {
		return StepResult{}, fmt.Errorf("%w: start without definition", domain.ErrFlowIntegrity())
	}
	initialStepName, ok := in.Definition.InitialStepFor(in.Purpose)
	if !ok {
		return StepResult{}, fmt.Errorf("%w: definition %q does not serve purpose %s", domain.ErrFlowIntegrity(), in.Definition.ID, in.Purpose)
	}

	state := &State{
		ID:            in.ID,
		ProjectID:     in.Definition.ProjectID,
		UserSchemaURL: in.UserSchemaURL,
		DeploymentID:  in.DeploymentID,
		ReleaseID:     in.ReleaseID,
		Progress: Progress{
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
		return StepResult{}, fmt.Errorf("%w: auth-attempt service not wired", domain.ErrFlowIntegrity())
	}
	attemptInput := CreateAttemptInput{ProjectID: state.ProjectID, FlowID: state.ID}
	if state.SessionID != "" {
		sid := state.SessionID
		attemptInput.SessionID = &sid
	}
	attemptID, err := r.authAttempts.Start(ctx, attemptInput)
	if err != nil {
		return StepResult{}, fmt.Errorf("flow state machine: start auth attempt: %w", err)
	}
	state.AuthAttemptID = attemptID

	step, err := r.renderStep(ctx, in.Definition, state)
	if err != nil {
		return StepResult{}, err
	}
	result := StepResult{State: state, Step: step}
	announceSignupGate(in.Definition, &result)
	return result, nil
}

// processCtx carries the per-submission context threaded through the
// action kind handlers and their helpers.
type processCtx struct {
	ctx context.Context
	// def is the active flow's definition, as [ActiveDefinition] returned it.
	def         *domain.FlowDefinition
	state       *State
	currentStep *domain.FlowDefinitionStep
	in          SubmitInput
}

// Process advances the flow one step by dispatching the submission to
// the handler for its action kind (see [actionKindHandlers]).
func (r *Runtime) Process(ctx context.Context, defs Definitions, state *State, in SubmitInput) (StepResult, error) {
	if defs == nil || state == nil {
		return StepResult{}, fmt.Errorf("%w: process without definition or state", domain.ErrFlowIntegrity())
	}
	def, err := ActiveDefinition(ctx, defs, state)
	if err != nil {
		return StepResult{}, err
	}
	// A dead attempt fails every submission that reaches it, so the flow
	// restarts here, as a render does. A handoff racing this read still ends
	// in att.already_handed_off.
	usable, err := r.authAttempts.Usable(ctx, state.ProjectID, state.AuthAttemptID)
	if err != nil {
		return StepResult{}, err
	}
	if !usable {
		return StepResult{}, domain.ErrFlowRestartRequired()
	}

	currentStep, ok := def.FindStep(state.CurrentStep)
	if !ok {
		return StepResult{}, fmt.Errorf("%w: current step %q missing from definition", domain.ErrFlowIntegrity(), state.CurrentStep)
	}

	for name := range in.GateProofs {
		if name != domain.SignupGate || !acceptsSignupProof(currentStep, state, in) {
			return StepResult{}, fmt.Errorf("%w: gate proofs", domain.ErrFlowUnsupported())
		}
	}
	pc := &processCtx{ctx: ctx, def: def, state: state, currentStep: currentStep, in: in}
	result, err := r.dispatch(pc)
	if err != nil {
		return result, err
	}
	announceSignupGate(def, &result)
	return result, nil
}

// dispatch runs the submission through the handler for its action kind.
func (r *Runtime) dispatch(pc *processCtx) (StepResult, error) {
	// An external sign-in collects nothing on the step, so it skips the
	// input pipeline like back and navigate do.
	if pc.in.Action == domain.FlowActionSSO || pc.in.SSOProvider != nil {
		return r.processSSO(pc)
	}
	handler, ok := actionKindHandlers[stepActionKind(pc.currentStep, pc.in.Action)]
	// Only an action the step declares can be submitted. The outcome names
	// (user_not_found, sso_authenticated, ...) are routed by the engine
	// alone; a client naming one would otherwise take that route.
	if !ok {
		return StepResult{}, fmt.Errorf("%w: %q on step %q", domain.ErrFlowInvalidAction(), pc.in.Action, pc.currentStep.Name)
	}
	return handler.process(r, pc)
}

// recordResolvedUser stores the resolved user id; if it changed, any
// state bound to the previous user is cleared.
func recordResolvedUser(state *State, userID string) {
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
func clearUserBoundState(state *State) {
	state.ClearPendingChallenge()
	state.CollectedData.UserID = ""
	state.CollectedData.SSOConflictConnectionID = ""
}
