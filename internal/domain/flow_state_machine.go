package domain

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/ianlancetaylor/jsonschema"

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
	// FlowStepErrorSSOCreationDisabled reports a provider identity with no
	// account on a connection whose provisioning.creation is disabled.
	FlowStepErrorSSOCreationDisabled = "error.sso_creation_disabled"
	// FlowStepErrorSSOUnavailable reports a provider the engine could not
	// start a sign-in with, or whose sign-in the current step cannot route.
	// The user stays on the step.
	FlowStepErrorSSOUnavailable = "error.sso_unavailable"
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
// GateProofs is reserved; the state machine returns [ErrFlowUnsupported]
// for any flow that exercises it today.
type FlowSubmitInput struct {
	Action     string
	Fields     map[string]any
	GateProofs map[string]string
	// SSOProvider names the provider the user picked. Read only with
	// [FlowActionSSO]; on any other action it is an invalid submission.
	SSOProvider *FlowSSOProviderRef
	// SSOReturn carries the callback route and the return page the API
	// derived from the request. Required on an sso submission.
	SSOReturn *FlowSSOReturn
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

// FlowSSOReturn is the browser-side context of an external sign-in,
// derived from the HTTP request at the API edge: RedirectURI is the
// callback route the provider sends the browser to, ReturnTarget the page
// the callback hands the browser back to.
type FlowSSOReturn struct {
	RedirectURI  string
	ReturnTarget string
}

// FlowStepResult is what the state machine returns from [Start] and
// [Process]. Pop is reserved for the deferred pivot stack. HandoffToken
// + HandoffTokenExpiresAt are populated only on the terminal step;
// SSOBindingNonce only on the [FlowStepNameSSORedirect] step, where the
// handler sets it as the browser-binding cookie. Reseal is set only by
// [Render], when resolving a parked SSO identity changed the state: the
// handler re-seals only such a render.
type FlowStepResult struct {
	State                 *FlowState
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
	Name         string
	Texts        FlowStepTexts
	Error        *string
	Complete     *FlowStepComplete
	RedirectURL  *string
	Fields       []FlowField
	Actions      []FlowAction
	SSOProviders []FlowSSOProvider
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

// FlowActionSSO is the action the client submits with
// [FlowSubmitInput.SSOProvider] to start an external sign-in. It is not
// declared on the step: offering sso_providers is what enables it.
const FlowActionSSO = "sso"

// FlowStepNameSSORedirect is the engine-emitted step that carries the
// provider's authorize URL. The flow state stays on the step the user
// picked the provider from; the callback moves it on.
const FlowStepNameSSORedirect = "sso-redirect"

// flowSSORedirectTitleKey is the step's only text; the client shows it
// while the browser navigates to the provider.
const flowSSORedirectTitleKey = "sso.redirect.title"

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
	schemas       SchemaResolver
	schemaStore   JSONSchemaStore
	fields        FlowFieldResolver
	userCreater   FlowOnSuccessHandler
	authAttempts  FlowAuthAttemptService
	ssoProviders  FlowSSOProviderResolver
	ssoIdentities FlowSSOIdentityService
	ssoRedirects  FlowSSORedirectIssuer
	now           func() time.Time
}

// NewFlowStateMachine wires the runtime. The now hook is injectable so
// tests can produce deterministic [FlowState.IssuedAt] values.
func NewFlowStateMachine(
	schemas SchemaResolver,
	schemaStore JSONSchemaStore,
	fields FlowFieldResolver,
	createUser FlowOnSuccessHandler,
	authAttempts FlowAuthAttemptService,
	ssoProviders FlowSSOProviderResolver,
	ssoIdentities FlowSSOIdentityService,
	ssoRedirects FlowSSORedirectIssuer,
	now func() time.Time,
) *FlowStateMachineRuntime {
	if now == nil {
		now = time.Now
	}
	return &FlowStateMachineRuntime{
		schemas:       schemas,
		schemaStore:   schemaStore,
		fields:        fields,
		userCreater:   createUser,
		authAttempts:  authAttempts,
		ssoProviders:  ssoProviders,
		ssoIdentities: ssoIdentities,
		ssoRedirects:  ssoRedirects,
		now:           now,
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

// Render re-emits the current step without advancing. It refreshes IssuedAt
// only when it resolves a parked SSO identity, the one render the handler
// re-seals.
func (r *FlowStateMachineRuntime) Render(ctx context.Context, def *FlowDefinition, state *FlowState) (FlowStepResult, error) {
	if def == nil || state == nil {
		return FlowStepResult{}, fmt.Errorf("%w: render without definition or state", ErrFlowIntegrity())
	}
	if result, reseal, err := r.resolveSSOIdentity(ctx, def, state); err != nil || result.Step != nil {
		result.Reseal = reseal
		return result, err
	}
	step, err := r.renderStep(ctx, def, state)
	if err != nil {
		return FlowStepResult{}, err
	}
	// Re-emit an in-flight ceremony so a page reload can resume it.
	attachPendingChallenge(step, state.PendingChallenge)
	return FlowStepResult{State: state, Step: step}, nil
}

// resolveSSOIdentity turns an external identity an SSO callback parked on the
// attempt into an outcome on the current step. A branch that produces the
// result always returns a step, and Render relies on that: a result without
// one goes on to render the step as usual. The bool reports that the state
// changed and the handler must re-seal it.
//
// It runs on every render, so every GET /flow/{id} pays one attempt read even
// without SSO. The read is not only for SSO: LoadParked also restarts any flow
// whose attempt expired or was handed off. Do not limit it to steps that offer
// sso_providers.
//
// The outcome is raised with an empty action, so an unwired transition
// degrades to the step-error re-render, as a handler diversion does.
func (r *FlowStateMachineRuntime) resolveSSOIdentity(ctx context.Context, def *FlowDefinition, state *FlowState) (FlowStepResult, bool, error) {
	currentStep, ok := def.FindStep(state.CurrentStep)
	if !ok {
		return FlowStepResult{}, false, fmt.Errorf("%w: current step %q missing from definition", ErrFlowIntegrity(), state.CurrentStep)
	}
	// A completed flow handed its attempt off; there is nothing to resolve.
	if currentStep.Complete != nil {
		return FlowStepResult{}, false, nil
	}
	loadInput := FlowSSOLoadInput{
		ProjectID:       state.ProjectID,
		AttemptID:       state.AuthAttemptID,
		UserSchemaURL:   state.UserSchemaURL,
		ResolvedCheckID: state.SSOResolvedCheckID,
	}
	parked, err := r.ssoIdentities.LoadParked(ctx, loadInput)
	if err != nil {
		return FlowStepResult{}, false, fmt.Errorf("flow state machine: load parked sso identity: %w", err)
	}
	// An earlier request bound the attempt but its handoff failed, and the
	// parked row is gone: raise the success outcome again, which mints the
	// handoff. A state that already carries a user has nothing to retry.
	if parked != nil && parked.BoundUserID != "" {
		if state.CollectedData.UserID != "" {
			return FlowStepResult{}, false, nil
		}
		pc := &processCtx{ctx: ctx, def: def, state: state, currentStep: currentStep}
		resolvedFields, err := r.resolveInputs(pc)
		if err != nil {
			return FlowStepResult{}, false, err
		}
		// Checked here as well, so the error render leaves the cookie alone:
		// the state does not change, and a reload shows the error again.
		if !ssoAuthenticatedRoutes(currentStep) {
			msg := FlowStepErrorSSOUnavailable
			result, err := r.renderStepError(pc, resolvedFields, &msg)
			return result, false, err
		}
		return r.retrySSOHandoff(pc, resolvedFields, parked.BoundUserID, false)
	}
	// A collision bound a user, but the cookie that recorded it lost the race
	// to one that recorded this row as collected: catch the state up.
	if parked != nil && parked.CollisionUserID != "" {
		// The marker counts only while the attempt still carries that user: a
		// stale submission may have overwritten the user factor since.
		if parked.AttemptUserID != parked.CollisionUserID {
			return FlowStepResult{}, false, ErrFlowRestartRequired()
		}
		switch state.CollectedData.UserID {
		case parked.CollisionUserID:
			// The user alone is no proof that this cookie recorded the
			// collision: the flow may have identified that user before SSO.
			if state.SSOResolvedCheckID == parked.CheckID {
				return FlowStepResult{}, false, nil
			}
		case "":
		default:
			return FlowStepResult{}, false, ErrFlowRestartRequired()
		}
		pc := &processCtx{ctx: ctx, def: def, state: state, currentStep: currentStep}
		resolvedFields, err := r.resolveInputs(pc)
		if err != nil {
			return FlowStepResult{}, false, err
		}
		// The bind may have run on another step, or under an older definition.
		if !userAlreadyExistsRoutes(currentStep) {
			msg := FlowStepErrorSSOUnavailable
			result, err := r.renderStepError(pc, resolvedFields, &msg)
			return result, false, err
		}
		state.SSOResolvedCheckID = parked.CheckID
		recordResolvedUser(state, parked.CollisionUserID)
		result, err := r.routeOutcome(pc, resolvedFields, FlowImplicitOutcomeUserAlreadyExists, false)
		return result, true, err
	}
	if parked == nil {
		return FlowStepResult{}, false, nil
	}

	pc := &processCtx{ctx: ctx, def: def, state: state, currentStep: currentStep}
	resolvedFields, err := r.resolveInputs(pc)
	if err != nil {
		return FlowStepResult{}, false, err
	}
	// Recorded before the branch work, so a failed branch is not retried on
	// every reload, and a row left parked for collection is not resolved twice.
	state.SSOResolvedCheckID = parked.CheckID

	if parked.Link == nil && parked.CreationDisabled {
		// The identity has no account and will not get one. The row stays
		// parked, so a failed render or seal re-runs this branch and shows the
		// error again; the replay guard in the sealed cookie keeps later
		// reloads from repeating it. The row expires with the attempt or is
		// replaced by the next ceremony.
		msg := FlowStepErrorSSOCreationDisabled
		result, err := r.renderStepError(pc, resolvedFields, &msg)
		return result, true, err
	}
	if parked.Link == nil {
		outcome, err := r.provisionSSOIdentity(ctx, state, currentStep, parked)
		if errors.Is(err, ErrSSOStateInvalid()) {
			return r.resolveStaleSSOBind(pc, resolvedFields, loadInput)
		}
		if errors.Is(err, errSSOUnroutable) {
			msg := FlowStepErrorSSOUnavailable
			result, err := r.renderStepError(pc, resolvedFields, &msg)
			return result, true, err
		}
		if err != nil {
			return FlowStepResult{}, false, err
		}
		// Creation bound the attempt, so a concurrent render can win the
		// handoff first, as after the linked bind. As after create_user, the
		// step that created the user offers no back.
		if outcome == FlowImplicitOutcomeSSOAuthenticated {
			return r.retrySSOHandoff(pc, resolvedFields, state.CollectedData.UserID, true)
		}
		result, err := r.routeOutcome(pc, resolvedFields, outcome, false)
		return result, true, err
	}

	// The bind cannot be undone, so it runs only when the outcome can route:
	// a stored definition is validated only on write. Otherwise the step
	// shows the provider as unavailable, and the row stays parked.
	if !ssoAuthenticatedRoutes(currentStep) {
		msg := FlowStepErrorSSOUnavailable
		result, err := r.renderStepError(pc, resolvedFields, &msg)
		return result, true, err
	}
	err = r.ssoIdentities.BindLinked(ctx, FlowSSOBindInput{
		ProjectID:    state.ProjectID,
		AttemptID:    state.AuthAttemptID,
		CheckID:      parked.CheckID,
		UserID:       parked.Link.UserID,
		ConnectionID: parked.ConnectionID,
		LinkID:       parked.Link.LinkID,
	})
	if errors.Is(err, ErrSSOStateInvalid()) {
		return r.resolveStaleSSOBind(pc, resolvedFields, loadInput)
	}
	if err != nil {
		return FlowStepResult{}, false, fmt.Errorf("flow state machine: bind sso identity: %w", err)
	}
	return r.retrySSOHandoff(pc, resolvedFields, parked.Link.UserID, false)
}

// provisionSSOIdentity settles an unlinked identity under `creation: auto`
// and returns the outcome to raise. A user owning one of the unique claims is
// bound (user_already_exists, as for a typed registration collision);
// otherwise complete, trusted claims create a linked user
// (sso_authenticated); anything else is collected (sso_user_not_found), with
// the row left parked for the prefill.
func (r *FlowStateMachineRuntime) provisionSSOIdentity(ctx context.Context, state *FlowState, step *FlowDefinitionStep, parked *FlowSSOParkedIdentity) (string, error) {
	schema, err := r.schemas.Resolve(ctx, r.schemaStore, state.ProjectID, state.UserSchemaURL, nil)
	if err != nil {
		return "", fmt.Errorf("flow state machine: load user schema for sso identity: %w", err)
	}
	// A connection can map a superset of properties for several schemas; this
	// schema consumes only the top-level properties it defines.
	claims := ssoSchemaClaims(schema, parked.Claims)
	probeClaims, uniqueClaims := ssoUniqueClaims(schema, claims)
	if bound, err := r.bindSSOCollision(ctx, state, step, parked, probeClaims); err != nil || bound {
		return FlowImplicitOutcomeUserAlreadyExists, err
	}
	// Neither linked to nor colliding with the user the flow or its attempt
	// carries (a signed-in session included): no new user can register on
	// that attempt, and it is not collected either. The bind helper stays the
	// backstop.
	if ssoBoundUser(state, parked) != "" {
		return "", ErrFlowRestartRequired()
	}
	if !ssoClaimsComplete(schema, parked, claims, uniqueClaims) {
		return FlowImplicitOutcomeSSOUserNotFound, nil
	}
	// The user and the link cannot be undone, so creation waits until
	// sso_authenticated can route, as the linked bind does.
	if !ssoAuthenticatedRoutes(step) {
		return "", errSSOUnroutable
	}

	attributes := map[string]any{}
	for name, value := range claims {
		if err := maputil.SetNested(attributes, AttributeKey(name).Nodes(), value); err != nil {
			return "", fmt.Errorf("flow state machine: sso claim %q: %w", name, err)
		}
	}
	userID, err := r.ssoIdentities.CreateLinked(ctx, FlowSSOCreateInput{
		ProjectID:     state.ProjectID,
		AttemptID:     state.AuthAttemptID,
		CheckID:       parked.CheckID,
		UserSchemaURL: state.UserSchemaURL,
		ConnectionID:  parked.ConnectionID,
		Subject:       parked.Subject,
		Attributes:    attributes,
	})
	if errors.Is(err, ErrUserAlreadyExists()) {
		// Another flow took a unique value since the probe (a request on this
		// attempt loses on the parked row instead): whoever took a probed
		// attribute is bound, and anything else falls back to collection.
		if bound, err := r.bindSSOCollision(ctx, state, step, parked, probeClaims); err != nil || bound {
			return FlowImplicitOutcomeUserAlreadyExists, err
		}
		return FlowImplicitOutcomeSSOUserNotFound, nil
	}
	if errors.Is(err, ErrUserInvalid()) {
		// A claim fails the schema (too long, bad format): collect it so the
		// user can fix it.
		return FlowImplicitOutcomeSSOUserNotFound, nil
	}
	if err != nil {
		return "", fmt.Errorf("flow state machine: create sso user: %w", err)
	}
	recordResolvedUser(state, userID)
	return FlowImplicitOutcomeSSOAuthenticated, nil
}

// ssoBoundUser is the user the flow already carries: the one its state
// recorded, or else the one its attempt carries, which a flow started on a
// signed-in session gets from that session without the state recording it.
func ssoBoundUser(state *FlowState, parked *FlowSSOParkedIdentity) string {
	if state.CollectedData.UserID != "" {
		return state.CollectedData.UserID
	}
	return parked.AttemptUserID
}

// ssoSchemaClaims keeps the claims whose name is a top-level property of the
// schema and drops the rest.
func ssoSchemaClaims(schema *jsonschema.Schema, claims map[string]any) map[string]any {
	root := newSchemaReader(schema)
	out := make(map[string]any, len(claims))
	for name, value := range claims {
		if _, ok := root.Property(name); ok {
			out[name] = value
		}
	}
	return out
}

// ssoUniqueClaims returns the claim names whose top-level schema property
// carries an x-unique scope (unique), and the project-scoped subset the
// collision check probes (probe), both sorted so the probe order is stable.
// Team scope is not probed, because the probe only asks the project-scoped
// registry; a team-scoped collision is still refused at creation and falls
// back to collection. An object or array property is unique like any other
// (the registry stores it), so it is in unique, but it is not probed: the
// lookup takes a single value. The annotation is read directly, so a claim
// whose property no flow step could render (a type union) is no error; a
// claim the schema does not know is skipped.
func ssoUniqueClaims(schema *jsonschema.Schema, claims map[string]any) (probe, unique []string) {
	root := newSchemaReader(schema)
	for name := range claims {
		prop, ok := root.Property(name)
		if !ok {
			continue
		}
		scope := deriveUnique(prop)
		if scope == AttributeUniquenessUnspecified {
			continue
		}
		unique = append(unique, name)
		if t, _ := prop.JSONType(); scope == AttributeUniquenessProject && t != "object" && t != "array" {
			probe = append(probe, name)
		}
	}
	slices.Sort(probe)
	slices.Sort(unique)
	return probe, unique
}

// errSSOUnroutable reports a collision or a creation on a step that cannot
// route its outcome. Nothing is written: the engine shows the provider as
// unavailable, as for a linked identity.
var errSSOUnroutable = errors.New("flow state machine: sso outcome cannot route on this step")

// bindSSOCollision looks up each project-unique claim, verified or not, until
// one names an existing user, then binds that user by id. Like a typed
// identifier it only binds the user: no link, no sso factor. The bind checks
// the exact parked row first and replaces it by a marker of that user, so a
// row another request replaced binds nothing (ErrSSOStateInvalid) and a
// retry after a lost cookie catches up from the marker. It returns
// errSSOUnroutable, before binding, when step cannot route
// user_already_exists.
func (r *FlowStateMachineRuntime) bindSSOCollision(ctx context.Context, state *FlowState, step *FlowDefinitionStep, parked *FlowSSOParkedIdentity, probeClaims []string) (bool, error) {
	for _, name := range probeClaims {
		value, _ := parked.Claims[name].(string)
		if value == "" {
			continue
		}
		// A read-only lookup: an identifier submission that misses records a
		// failed check on the attempt, and a miss here is no sign-in attempt.
		owner, err := r.ssoIdentities.FindUniqueOwner(ctx, state.ProjectID, state.UserSchemaURL, name, value)
		if err != nil {
			return false, fmt.Errorf("flow state machine: look up sso claim %q: %w", name, err)
		}
		if owner == "" {
			continue
		}
		// The bind refuses another bound user too; this makes the invariant
		// explicit in the engine.
		if bound := ssoBoundUser(state, parked); bound != "" && bound != owner {
			return false, ErrFlowRestartRequired()
		}
		// The bind cannot be undone, and the validator does not require
		// user_already_exists on a step with sso_providers, so the bind waits
		// until the outcome can route. A declared purpose can: it starts that
		// purpose fresh, as it does for a typed collision.
		if !userAlreadyExistsRoutes(step) {
			return false, errSSOUnroutable
		}
		if err := r.ssoIdentities.BindCollision(ctx, FlowSSOBindInput{
			ProjectID: state.ProjectID,
			AttemptID: state.AuthAttemptID,
			CheckID:   parked.CheckID,
			UserID:    owner,
		}); err != nil {
			return false, fmt.Errorf("flow state machine: bind sso collision: %w", err)
		}
		recordResolvedUser(state, owner)
		return true, nil
	}
	return false, nil
}

// ssoClaimsComplete reports whether the claims can create a user unattended:
// every required property has a claim, and every required unique one arrived
// verified, so an unverified address cannot claim an account. Claims are
// top-level, so a required nested object never completes.
func ssoClaimsComplete(schema *jsonschema.Schema, parked *FlowSSOParkedIdentity, claims map[string]any, uniqueClaims []string) bool {
	// RequiredPaths reads `required` and `properties` only. Requiredness a
	// composition or a reference adds, at any depth, is not evaluated, so such
	// a schema never creates a user unattended: the verified-unique rule must
	// not be bypassable.
	if newSchemaReader(schema).ComposesRequiredness() {
		return false
	}
	for name := range claims {
		// Attribute keys use the dot as a path separator, so a top-level property
		// whose name has one would be stored as a nested object.
		if strings.Contains(name, ".") {
			return false
		}
	}
	materialized := make(map[string]struct{}, len(claims))
	for name := range claims {
		materialized[name] = struct{}{}
	}
	for path := range newSchemaReader(schema).RequiredPaths(materialized) {
		if claims[path] == nil {
			return false
		}
		if slices.Contains(uniqueClaims, path) && !parked.Verified[path] {
			return false
		}
	}
	return true
}

// resolveStaleSSOBind handles a bind that found its parked row gone: a
// concurrent request settled it, or a new ceremony replaced it. One more read
// tells which.
func (r *FlowStateMachineRuntime) resolveStaleSSOBind(pc *processCtx, resolvedFields FlowResolvedFields, loadInput FlowSSOLoadInput) (FlowStepResult, bool, error) {
	reread, err := r.ssoIdentities.LoadParked(pc.ctx, loadInput)
	if err != nil {
		// Handed off or expired: restart, so this response cannot reseal a
		// cookie over the winner's. Any other read failure is returned as is.
		return FlowStepResult{}, false, fmt.Errorf("flow state machine: reload parked sso identity: %w", err)
	}
	if reread == nil || reread.BoundUserID == "" {
		// Replaced, or settled by a collision whose marker the next render
		// reconciles: render the step.
		return FlowStepResult{}, false, nil
	}
	return r.retrySSOHandoff(pc, resolvedFields, reread.BoundUserID, false)
}

// retrySSOHandoff raises sso_authenticated for a user bound on the attempt,
// which mints the handoff. The bind is this request's or an earlier one whose
// request did not deliver the handoff; either way a concurrent render can win
// the handoff first. irreversible clears the back stack. A retry cannot tell
// a created user from a linked one, so it passes false.
func (r *FlowStateMachineRuntime) retrySSOHandoff(pc *processCtx, resolvedFields FlowResolvedFields, userID string, irreversible bool) (FlowStepResult, bool, error) {
	// An earlier bind may have run on another step, or under an older
	// definition. Checked before the user is recorded: a purpose would drop
	// that user and move the flow to a fresh attempt.
	if !ssoAuthenticatedRoutes(pc.currentStep) {
		msg := FlowStepErrorSSOUnavailable
		result, err := r.renderStepError(pc, resolvedFields, &msg)
		return result, true, err
	}
	recordResolvedUser(pc.state, userID)
	result, err := r.routeOutcome(pc, resolvedFields, FlowImplicitOutcomeSSOAuthenticated, irreversible)
	if errors.Is(err, ErrAuthAttemptAlreadyHandedOff()) {
		// A concurrent retry won the handoff. A handed-off attempt restarts
		// the flow on every later render too, so this one does the same.
		return FlowStepResult{}, false, ErrFlowRestartRequired().WithParent(err)
	}
	return result, true, err
}

// ssoAuthenticatedRoutes reports whether step routes sso_authenticated within
// this flow, keeping the bound user.
func ssoAuthenticatedRoutes(step *FlowDefinitionStep) bool {
	t, ok := step.Transitions[FlowImplicitOutcomeSSOAuthenticated]
	return ok && t.Action == nil && t.Purpose == nil
}

// userAlreadyExistsRoutes reports whether step routes user_already_exists
// within this flow. A purpose counts: it starts that purpose fresh.
func userAlreadyExistsRoutes(step *FlowDefinitionStep) bool {
	t, ok := step.Transitions[FlowImplicitOutcomeUserAlreadyExists]
	return ok && t.Action == nil
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
	if len(in.GateProofs) > 0 {
		return FlowStepResult{}, fmt.Errorf("%w: gate proofs", ErrFlowUnsupported())
	}

	currentStep, ok := def.FindStep(state.CurrentStep)
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: current step %q missing from definition", ErrFlowIntegrity(), state.CurrentStep)
	}

	pc := &processCtx{ctx: ctx, def: def, state: state, currentStep: currentStep, in: in}
	// An external sign-in collects nothing on the step, so it skips the
	// input pipeline like back and navigate do.
	if in.Action == FlowActionSSO || in.SSOProvider != nil {
		return r.processSSO(pc)
	}
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
	if actionKind == FlowActionKindPasskey {
		pc.in.Fields = identifierFieldsOnly(resolved, pc.in.Fields)
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

// processSSO starts an external sign-in with a provider the step offers
// and emits the redirect step. The flow state is left as it is: the user
// is still on this step until the resolution after the callback routes it.
// IssuedAt is refreshed like on every submit, so the flow cookie's
// window restarts at this submission.
func (r *FlowStateMachineRuntime) processSSO(pc *processCtx) (FlowStepResult, error) {
	in := pc.in
	if in.Action != FlowActionSSO || in.SSOProvider == nil {
		return FlowStepResult{}, fmt.Errorf("%w: %q with sso provider on step %q", ErrFlowInvalidAction(), in.Action, pc.currentStep.Name)
	}
	if !slices.Contains(pc.currentStep.SSOProviders, in.SSOProvider.ID) {
		return FlowStepResult{}, fmt.Errorf("%w: sso provider %q is not offered on step %q", ErrFlowInvalidAction(), in.SSOProvider.ID, pc.currentStep.Name)
	}
	if in.SSOReturn == nil {
		return FlowStepResult{}, fmt.Errorf("%w: sso return params missing", ErrFlowIntegrity())
	}
	// Leaving for the provider abandons any pending ceremony; without this
	// the stale challenge re-attaches on the next render (the mismatch
	// cleanup in Process never runs on this early-return path).
	pc.state.ClearPendingChallenge()
	out, err := r.ssoRedirects.Issue(pc.ctx, FlowIssueSSORedirectInput{
		ProjectID:     pc.state.ProjectID,
		AttemptID:     pc.state.AuthAttemptID,
		ProviderSlug:  in.SSOProvider.ID,
		FlowSSOReturn: *in.SSOReturn,
	})
	switch {
	case errors.Is(err, ErrIDPConnectionNotFound()):
		// The render dropped the slug, so the client never offered it.
		return FlowStepResult{}, fmt.Errorf("%w: sso provider %q on step %q has no connection", ErrFlowInvalidAction(), in.SSOProvider.ID, pc.currentStep.Name)
	case errors.Is(err, ErrFlowSSOUnavailable(nil)):
		resolved, err := r.resolveInputs(pc)
		if err != nil {
			return FlowStepResult{}, err
		}
		return r.renderStepError(pc, resolved, new(FlowStepErrorSSOUnavailable))
	case err != nil:
		return FlowStepResult{}, err
	}
	pc.state.IssuedAt = r.now()
	return FlowStepResult{
		State: pc.state,
		Step: &FlowStep{
			Name:        FlowStepNameSSORedirect,
			Texts:       FlowStepTexts{TitleKey: flowSSORedirectTitleKey},
			RedirectURL: &out.RedirectURL,
		},
		SSOBindingNonce: out.BindingNonce,
	}, nil
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
// Every action validates the values it sent — which is why a leg that
// consumes a subset is narrowed to that subset before it gets here (see
// [identifierFieldsOnly]); field-collecting actions (see
// [collectsStepFields]) additionally require declared required fields to be
// present.
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
		step, err := r.buildStep(pc.ctx, pc.state, pc.currentStep, resolved, new(errs.StepError()), nil, nil)
		if err != nil {
			return nil, err
		}
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
func (r *FlowStateMachineRuntime) renderStepError(pc *processCtx, resolved FlowResolvedFields, errKey *string) (FlowStepResult, error) {
	step, err := r.buildStep(pc.ctx, pc.state, pc.currentStep, resolved, errKey, nil, nil)
	if err != nil {
		return FlowStepResult{}, err
	}
	pc.state.IssuedAt = r.now()
	return FlowStepResult{State: pc.state, Step: step}, nil
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
			return r.renderStepError(pc, resolved, &msg)
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
		if err := r.dropResolvedUser(pc, "re-purpose"); err != nil {
			return FlowStepResult{}, err
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

// dropResolvedUser abandons the identity this flow had settled on: the
// resolved user, the credential material collected to authenticate them, and
// any in-flight ceremony. When a user was resolved it rotates the auth
// attempt in lockstep.
//
// The collected password goes because it belongs to the identity being
// dropped, and [mergeCollected] banks it before the proof is ever checked —
// so a rejected password outlives its attempt otherwise, and would be handed
// to create_user for whoever the flow resolves next. Nothing prefills from
// it (a password field always renders empty), so clearing it costs the user
// nothing.
//
// The persisted attempt carries the resolved user as a factor, and
// PrepareUserChallenge refuses a second user challenge on a session-linked
// attempt — which every flow is, since the flow service links the attempt to
// the session it runs against. Clearing the flow state without rotating
// leaves the attempt one step ahead of the flow, and the next identifier
// submission dies on "The user was already authenticated". The abandoned
// attempt ages out like any abandoned flow. No resolved user → nothing on the
// attempt to escape → no rotation (idle navigation must not mint attempt
// rows). reason names the caller for the wrapped error.
func (r *FlowStateMachineRuntime) dropResolvedUser(pc *processCtx, reason string) error {
	hadResolvedUser := pc.state.CollectedData.UserID != ""
	clearUserBoundState(pc.state)
	pc.state.CollectedData.AuthMethods.Password = ""
	if !hadResolvedUser {
		return nil
	}
	attemptInput := FlowCreateAttemptInput{ProjectID: pc.state.ProjectID}
	if pc.state.SessionID != "" {
		sid := pc.state.SessionID
		attemptInput.SessionID = &sid
	}
	attemptID, err := r.authAttempts.Start(pc.ctx, attemptInput)
	if err != nil {
		return fmt.Errorf("flow state machine: rotate auth attempt on %s: %w", reason, err)
	}
	pc.state.AuthAttemptID = attemptID
	return nil
}

// processSubmit handles kind=submit: dispatch challenges, run
// on_success (if declared), and route the resulting outcome.
func (r *FlowStateMachineRuntime) processSubmit(pc *processCtx, resolved FlowResolvedFields) (FlowStepResult, error) {
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
		return r.renderStepError(pc, resolved, result.StepError)
	}
	if result.UserID != "" {
		// The handler already recorded the user's factors on the attempt
		// inside its own transaction; only the flow state needs the id.
		recordResolvedUser(pc.state, result.UserID)
	}
	return r.routeOutcome(pc, resolved, pc.in.Action, result.Irreversible)
}

// processPasskeyLogin handles kind=passkey. The issue leg runs the
// identifier dispatch so IssuePasskeyChallenge can populate
// allowCredentials — and only that, because the leg reaches here holding
// nothing else (see [identifierFieldsOnly]); the verify leg validates the
// assertion. Ceremony abandonment falls through to the standard pipeline.
func (r *FlowStateMachineRuntime) processPasskeyLogin(pc *processCtx, resolved FlowResolvedFields) (FlowStepResult, error) {
	if pc.in.ChallengeResponse == nil {
		dispatch, err := r.dispatchChallenges(pc, resolved)
		if err != nil {
			return FlowStepResult{}, err
		}
		if dispatch.StepError != nil {
			return r.renderStepError(pc, resolved, dispatch.StepError)
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

// identifierFieldsOnly keeps just the identifier-challenge entries of a
// submission. A passkey login leg consumes exactly one value — the identifier
// that scopes allowCredentials — but browsers post the whole form, so the
// step's other fields ride along with the action. Choosing "sign in with a
// passkey" is not a submission of those fields: validating them fails the leg
// on an empty required password, and dispatching them verifies that password
// as a credential — both before the WebAuthn prompt ever appears. Dropping
// them here keeps validation, dispatch, and collection agreeing on what the
// leg was given.
//
// What survives is whatever the *current step* declares as an identifier
// field — so an identifier step keeps its value, empty or not, and the rules
// deciding whether a blank identifier is usable keep applying to it, while a
// step that declares no identifier (the password step) submits nothing at
// all. That is the discoverable ceremony: the assertion carries the user
// handle instead.
func identifierFieldsOnly(resolved FlowResolvedFields, values map[string]any) map[string]any {
	kept := make(map[string]any)
	for _, field := range resolved.Fields {
		if field.Challenge != FlowFieldChallengeIdentifier {
			continue
		}
		if value, submitted := values[field.Name]; submitted {
			kept[field.Name] = value
		}
	}
	return kept
}

// applyOutcomeFlip flips CurrentPurpose on resolution outcomes:
// login + user_not_found → register; login + sso_user_not_found → register;
// register + user_already_exists → login, typed or SSO. Recovery never flips.
func applyOutcomeFlip(state *FlowState, outcome string) {
	switch {
	case state.CurrentPurpose == FlowDefinitionPurposeLogin &&
		(outcome == FlowImplicitOutcomeUserNotFound || outcome == FlowImplicitOutcomeSSOUserNotFound):
		state.CurrentPurpose = FlowDefinitionPurposeRegister
	case state.CurrentPurpose == FlowDefinitionPurposeRegister && outcome == FlowImplicitOutcomeUserAlreadyExists:
		state.CurrentPurpose = FlowDefinitionPurposeLogin
	}
}

// dispatchChallenges submits field-shaped challenges in
// [challengeDispatchOrder]. CurrentPurpose decides verify-vs-skip. What
// reaches it is what the action submitted, so a leg that consumes a subset
// (see [identifierFieldsOnly]) dispatches a subset.
func (r *FlowStateMachineRuntime) dispatchChallenges(pc *processCtx, resolved FlowResolvedFields) (flowDispatchResult, error) {
	ctx, state, fields := pc.ctx, pc.state, pc.in.Fields
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
			// A successful lookup pins the user on the attempt whichever
			// purpose asked for it, so the flow records it either way.
			// user_already_exists then flips to login and routes to
			// verification, where the flow is verifying exactly this user — so
			// recording is honest, and it keeps CollectedData.UserID a truthful
			// signal of what the attempt carries. Left blank, the two fall out
			// of step: back skips its rotation and terminate skips the handoff.
			recordResolvedUser(state, userID)
			if state.CurrentPurpose == FlowDefinitionPurposeRegister {
				return flowDispatchResult{Outcome: FlowImplicitOutcomeUserAlreadyExists}, nil
			}
		case FlowFieldChallengePassword:
			if state.CurrentPurpose != FlowDefinitionPurposeLogin {
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

// uniqueFieldValues returns every uniquely-keyed field with a collected
// value, in field order and deduplicated by name across the given resolved
// sets. Conflict re-resolution is about uniqueness, not identification
// (ADR 058): the race was lost on some unique attribute, designated or
// not, so the candidate list keys on FlowField.Unique — the designated
// identifier alone would miss an undesignated unique attribute (a taken
// username beside a fresh email). The lookup behind SubmitIdentifier goes
// through the unique-attributes registry, so probing any unique attribute
// is well-defined regardless of designation.
func uniqueFieldValues(values map[string]any, resolvedSets ...FlowResolvedFields) [][2]string {
	var out [][2]string
	seen := map[string]bool{}
	for _, resolved := range resolvedSets {
		for _, field := range resolved.Fields {
			if field.Unique == AttributeUniquenessUnspecified || seen[field.Name] {
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
		rendered, err := r.buildStep(ctx, pc.state, pc.currentStep, resolved, nil, nil, nil)
		if err != nil {
			return passkeyPhaseResult{}, err
		}
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
				rendered, err := r.buildStep(ctx, pc.state, pc.currentStep, resolved, &msg, nil, nil)
				if err != nil {
					return passkeyPhaseResult{}, err
				}
				state.IssuedAt = r.now()
				return passkeyPhaseResult{handled: true, halt: &FlowStepResult{State: state, Step: rendered}}, nil
			}
			if errors.Is(err, ErrUserAlreadyExists()) {
				// A unique attribute of the provisional user is taken: route
				// like the identifier dispatch does. That path pins the
				// existing user on the attempt before routing — and the
				// downstream password step requires a persisted user factor —
				// so re-resolve the conflicting owner here to land in the
				// same state. Trying every collected uniquely-keyed field
				// finds the owner even when the race was lost on an
				// undesignated unique attribute (e.g. a fresh email but a
				// taken phone).
				clearUserBoundState(state)
				candidates := uniqueFieldValues(state.CollectedData.UserData, passkeyResolved)
				if visited, verr := r.resolveVisitedFields(pc); verr == nil {
					candidates = uniqueFieldValues(state.CollectedData.UserData, passkeyResolved, visited)
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
				rendered, err := r.buildStep(ctx, pc.state, pc.currentStep, resolved, &msg, nil, nil)
				if err != nil {
					return passkeyPhaseResult{}, err
				}
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
				rendered, err := r.buildStep(ctx, pc.state, pc.currentStep, resolved, &msg, nil, nil)
				if err != nil {
					return passkeyPhaseResult{}, err
				}
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
		rendered, err := r.buildStep(ctx, pc.state, pc.currentStep, resolved, nil, nil, nil)
		if err != nil {
			return passkeyPhaseResult{}, err
		}
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
		rendered, err := r.buildStep(ctx, pc.state, pc.currentStep, resolved, nil, nil, nil)
		if err != nil {
			return passkeyPhaseResult{}, err
		}
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

// processBack pops the previous BackStack entry and re-renders that step,
// restoring the snapshotted purpose. PendingChallenge is dropped; History is
// left intact.
//
// CollectedData.UserData survives, so the previous form prefills. The rest of
// CollectedData depends on where back lands: a step that collects the
// identifier is the user going back to change who they are signing in as, so
// the resolved user and the password collected for them go too, and the auth
// attempt rotates with them (see [dropResolvedUser]). Landing anywhere else
// leaves all of it in place.
func (r *FlowStateMachineRuntime) processBack(pc *processCtx) (FlowStepResult, error) {
	prev, ok := pc.state.PeekBackStack()
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: back submitted with empty back stack on step %q", ErrFlowInvalidAction(), pc.state.CurrentStep)
	}
	prevStep, ok := pc.def.FindStep(prev.StepName)
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: back-stack step %q missing from definition", ErrFlowIntegrity(), prev.StepName)
	}
	pc.state.PopBackStack()
	pc.state.CurrentStep = prev.StepName
	pc.state.CurrentPurpose = prev.Purpose
	pc.state.ClearPendingChallenge()

	// One resolution serves both the identifier check and the render below:
	// it is the same step either way, and resolving twice would double the
	// schema load and the chance of a transient failure on one back click.
	resolved, err := r.resolveStepFields(pc.ctx, pc.state, prevStep)
	if err != nil {
		return FlowStepResult{}, err
	}

	// The identifier is re-offered, so the user may submit a different one —
	// and even an unchanged one re-runs the user challenge. Both need an
	// attempt without a user factor on it; keeping the resolved user would
	// also scope the next passkey ceremony's allowCredentials to whoever the
	// abandoned leg resolved.
	collectsIdentifier := slices.ContainsFunc(resolved.Fields, func(f FlowField) bool {
		return f.Challenge == FlowFieldChallengeIdentifier
	})
	if collectsIdentifier {
		if err := r.dropResolvedUser(pc, "back to identification"); err != nil {
			return FlowStepResult{}, err
		}
	}

	// Prefill and build after the drop, so the step reflects the state the
	// user is actually returning to.
	prefillFromCollected(&resolved, pc.state.CollectedData.UserData)
	step, err := r.buildStep(pc.ctx, pc.state, prevStep, resolved, nil, nil, nil)
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
// Callers advance state before invoking so state.CurrentStep already points
// at the step they want rendered. Back does not come through here: it
// resolves its target once and builds from that set.
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
	// A terminal step renders as complete, so a re-render of a finished flow
	// says so (GET /flow/{id} answers 410 on it).
	return r.buildStep(ctx, state, step, resolved, nil, step.Complete, nil)
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
	// First-encounter order, not map order: consumers walk these fields
	// positionally (uniqueFieldValues promises field order), so the union
	// must be deterministic — visited steps in history order, fields in
	// their step order.
	seen := map[Field]struct{}{}
	names := make([]Field, 0, 8)
	collect := func(s *FlowDefinitionStep) {
		if s == nil {
			return
		}
		for _, f := range s.Fields {
			if _, ok := seen[f]; ok {
				continue
			}
			seen[f] = struct{}{}
			names = append(names, f)
		}
	}
	for _, name := range state.History {
		if s, ok := def.FindStep(name); ok {
			collect(s)
		}
	}
	collect(current)
	if len(names) == 0 {
		return FlowResolvedFields{}, nil
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

// buildStep assembles a FlowStep from the raw pieces. The step it renders is
// always the caller's to name: Start and renderStep supply state + step
// directly, mid-pipeline callers pass pc.state + pc.currentStep, and
// processBack passes pc.state with the back-stack step it just popped to.
func (r *FlowStateMachineRuntime) buildStep(ctx context.Context, state *FlowState, step *FlowDefinitionStep, resolved FlowResolvedFields, errorKey *string, complete *FlowStepComplete, redirectURL *string) (*FlowStep, error) {
	providers, err := r.resolveSSOProviders(ctx, state, step)
	if err != nil {
		return nil, err
	}
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
	applyAutocomplete(resolved.Fields, state.CurrentPurpose)
	return &FlowStep{
		Name:         step.Name,
		Texts:        FlowStepTexts{TitleKey: step.Name + ".title", DescriptionKey: step.Name + ".description"},
		Error:        errorKey,
		Complete:     complete,
		RedirectURL:  redirectURL,
		Fields:       resolved.Fields,
		Actions:      actions,
		SSOProviders: providers,
		Identifier:   pairedIdentifier(resolved, state.CollectedData.UserData),
	}, nil
}

// applyAutocomplete stamps each field's autofill token. The purpose is not
// known at resolve time — the definition validator resolves without one, and
// applyOutcomeFlip can change it mid-flow — so the token belongs to a render
// rather than to the resolved field set.
func applyAutocomplete(fields []FlowField, purpose FlowDefinitionPurpose) {
	for i := range fields {
		fields[i].Autocomplete = AutocompleteForField(fields[i], purpose)
	}
}

// pairedIdentifier returns the identifier a password form carries beside
// the password input so a manager can store the two as one credential.
// Nil unless the step collects a password, collects no identifier of its
// own, and the schema designates one a value was collected for.
func pairedIdentifier(resolved FlowResolvedFields, collected map[string]any) *FlowStepIdentifier {
	if resolved.IdentifierName == "" {
		return nil
	}
	var holdsPassword bool
	for _, f := range resolved.Fields {
		switch f.Challenge {
		case FlowFieldChallengeIdentifier:
			return nil
		case FlowFieldChallengePassword:
			holdsPassword = true
		}
	}
	if !holdsPassword {
		return nil
	}
	value, ok := collectedString(collected, resolved.IdentifierName)
	if !ok {
		return nil
	}
	return &FlowStepIdentifier{
		Value:        value,
		Autocomplete: AutocompleteUsername,
	}
}

// resolveSSOProviders renders the step's connection slugs through the
// resolver. Resolution runs on every render rather than once per flow, so
// an edit to a connection's display name shows on the next page load.
func (r *FlowStateMachineRuntime) resolveSSOProviders(ctx context.Context, state *FlowState, step *FlowDefinitionStep) ([]FlowSSOProvider, error) {
	if len(step.SSOProviders) == 0 {
		return nil, nil
	}
	if r.ssoProviders == nil {
		return nil, fmt.Errorf("%w: sso provider resolver not wired", ErrFlowIntegrity())
	}
	providers, err := r.ssoProviders.Resolve(ctx, state.ProjectID, step.Name, step.SSOProviders)
	if err != nil {
		return nil, fmt.Errorf("flow state machine: resolve sso providers on step %q: %w", step.Name, err)
	}
	return providers, nil
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
		if v, ok := collectedString(collected, resolved.Fields[i].Name); ok {
			val := v
			resolved.Fields[i].Value = &val
		}
	}
}

// collectedString returns the value collected for a dotted property path when
// one is there and non-empty. A collected-but-empty value is the same as
// nothing to the callers that re-render it: there is no prefill to make and no
// identifier to pair.
//
// [FindCollectedFieldByChallenge] deliberately does not go through here — it
// reads a value of any type and asks only whether it is present.
func collectedString(collected map[string]any, name string) (string, bool) {
	v, ok := maputil.GetNested[string](collected, AttributeKey(name).Nodes())
	if !ok || v == "" {
		return "", false
	}
	return v, true
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
