package domain

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// FlowOnSuccessHandler runs a step's side effect after field validation
// and before the state machine advances on the submitted action. The
// handler reports which outcome the state machine should advance on, or
// surfaces a step-level failure that keeps the user on the current step.
//
// Each handler is registered under a stable name (e.g. "create_user",
// "verify_credentials"); [FlowDefinitionStep.OnSuccess] references that
// name. The registry is the only public seam — new handlers slot in
// without the state machine knowing about them.
type FlowOnSuccessHandler interface {
	// Handle runs the side effect and reports the outcome.
	Handle(ctx context.Context, client database.QueryExecutor, in FlowOnSuccessInput) (FlowOnSuccessResult, error)
}

// FlowOnSuccessInput is the per-call context the state machine threads
// into a handler. Fields carries the values the resolver already
// validated; Resolved is the per-field metadata for the current step
// (challenge classification, validation rules) — handlers use it to
// pick out which field is the identifier, which is the credential,
// and so on. State is the current flow state; handlers may read it,
// and may surface state-level changes (resolved user id) through the
// returned [FlowOnSuccessResult].
type FlowOnSuccessInput struct {
	ProjectID     string
	UserSchemaURL string
	Fields        map[string]any
	Resolved      FlowResolvedFields
	State         *FlowState
	ResolvedFlow  *FlowDefinition
}

// FlowOnSuccessResult is what a handler returns. Exactly one of Outcome
// or StepError is meaningful per call:
//
//   - Outcome empty + StepError nil  → success; the state machine
//     advances on the action the client submitted.
//   - Outcome non-empty + StepError nil → success-with-routing; the
//     state machine advances on the named outcome instead of the
//     submitted action. The outcome must match a transition declared
//     on the current step.
//   - StepError non-nil → recoverable failure; the state machine keeps
//     the user on the current step and surfaces StepError on
//     [FlowStep.Error]. Outcome is ignored.
type FlowOnSuccessResult struct {
	// Outcome overrides the transition key the state machine advances
	// on. Empty means "use the submitted action".
	Outcome string

	// StepError carries a localization key for a step-level error to
	// render to the user. Non-nil signals a recoverable failure that
	// stops the advance.
	StepError *string

	// UserID, when set, is recorded on [FlowState] as the resolved
	// user identifier (e.g. after a successful create_user or
	// verify_credentials).
	UserID string
}

// FlowOnSuccessRegistry resolves a handler by its registered name. The
// state machine calls [Lookup] for every step that declares an
// [FlowDefinitionStep.OnSuccess]; an unknown name surfaces as
// [ErrUnknownOnSuccessHandler].
type FlowOnSuccessRegistry struct {
	handlers map[string]FlowOnSuccessHandler
}

// NewFlowOnSuccessRegistry returns an empty registry. Register
// handlers with [FlowOnSuccessRegistry.Register].
func NewFlowOnSuccessRegistry() *FlowOnSuccessRegistry {
	return &FlowOnSuccessRegistry{handlers: map[string]FlowOnSuccessHandler{}}
}

// Register associates a handler with a name. Re-registering the same
// name returns an error rather than silently overriding — production
// wiring happens at bootstrap and a duplicate is almost always a bug.
func (r *FlowOnSuccessRegistry) Register(name string, h FlowOnSuccessHandler) error {
	if name == "" {
		return fmt.Errorf("flow on_success registry: name must not be empty")
	}
	if h == nil {
		return fmt.Errorf("flow on_success registry: handler for %q is nil", name)
	}
	if _, exists := r.handlers[name]; exists {
		return fmt.Errorf("flow on_success registry: handler %q already registered", name)
	}
	r.handlers[name] = h
	return nil
}

// Lookup returns the handler registered under name. Returns
// [ErrUnknownOnSuccessHandler] if no such handler exists.
func (r *FlowOnSuccessRegistry) Lookup(name string) (FlowOnSuccessHandler, error) {
	h, ok := r.handlers[name]
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrUnknownOnSuccessHandler, name)
	}
	return h, nil
}

// Names registered with the on_success registry. Stable handler ids
// the state machine and definition validators reference.
const (
	FlowOnSuccessCreateUser         = "create_user"
	FlowOnSuccessVerifyCredentials  = "verify_credentials"
)

// FlowImplicitOutcomeInvalidCredentials is the outcome surfaced by
// [FlowOnSuccessVerifyCredentials] when an identifier resolves but
// the supplied credential is wrong. Steps that route on it must
// declare a matching transition; otherwise the state machine surfaces
// it as [FlowStep.Error] and stays put.
const FlowImplicitOutcomeInvalidCredentials = "invalid_credentials"

// ErrUnknownOnSuccessHandler is returned by
// [FlowOnSuccessRegistry.Lookup] for a name that has never been
// registered. The state machine maps it to [ErrIntegrity] — referring
// to an unknown handler means the definition was activated against a
// registry it isn't compatible with.
var ErrUnknownOnSuccessHandler = errors.New("flow on_success registry: handler not registered")
