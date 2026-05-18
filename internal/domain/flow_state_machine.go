package domain

import (
	"context"
	"errors"

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
}

// FlowStartInput carries everything the state machine needs to bootstrap
// a new flow: the resolved definition, the purpose, the session it sits
// on top of, and the audience hint used to pick the definition.
//
// UserSchemaURL is the resolved location of the user schema this flow
// validates against. The state machine plumbs it through to
// [FlowFieldResolver]; it is captured here (rather than re-derived per
// step) because the schema is constant for the lifetime of a flow.
type FlowStartInput struct {
	Definition    *FlowDefinition
	Purpose       FlowDefinitionPurpose
	Session       FlowSessionRef
	AuthRequest   *FlowAuthRequestRef
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
// outside an OIDC context (standalone registration, recovery).
type FlowAuthRequestRef struct {
	// ID is the authorization request identifier the OIDC layer
	// minted.
	ID string

	// RedirectURI is the terminal redirect destination for
	// [FlowStepCompleteRedirect] flows.
	RedirectURI string

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
