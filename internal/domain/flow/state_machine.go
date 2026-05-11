package flow

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

// StateMachine applies transitions, runs on-success hooks, evaluates
// implicit policy, and produces the next visible step.
//
// The handler decodes the cookie into a [*State] before calling
// [StateMachine.Process] and re-encodes the [StepResult.State] afterwards.
// The state machine itself never reads or writes cookies.
type StateMachine interface {
	// Start initializes a new flow on top of (possibly empty) prior state.
	Start(ctx context.Context, in StartInput) (StepResult, error)

	// Process consumes a client submission and produces the next visible step.
	Process(ctx context.Context, state *State, in SubmitInput) (StepResult, error)
}

// StartInput is the input to [StateMachine.Start].
type StartInput struct {
	Definition *domain.FlowDefinition
	Purpose    domain.FlowDefinitionPurpose
	Session    SessionRef
	Parent     *State // non-nil when starting via pivot
	AuthReq    *AuthRequestRef
	Hint       SelectorHint
}

// SubmitInput is the input to [StateMachine.Process].
type SubmitInput struct {
	Action      string
	Fields      map[string]any
	GateProofs  map[string]string
	SSOProvider *string
}

// StepResult is the output of every state-machine call.
type StepResult struct {
	// State is the updated runtime state. The handler re-encodes it into
	// the cookie before responding.
	State *State

	// Step is the capability payload to render for the client. It is nil
	// only on transport-level failures; validation errors set Step.Error
	// rather than returning a nil Step.
	Step *Step

	// Pop is set when a stacked flow has just completed and the parent's
	// next step is in Step. Reserved for handler-side observability.
	Pop bool
}
