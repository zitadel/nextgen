package flow

import "context"

// PolicyEvaluator is the seam the state machine consults before emitting
// a step. It can short-circuit a transition (jump straight to a terminal
// step when assurance is already sufficient) and can inject gates that
// the flow definition did not declare.
//
// The MVP ships a stub implementation; production wiring lives in the
// service layer.
type PolicyEvaluator interface {
	// Evaluate is called between transition resolution and step emission.
	Evaluate(ctx context.Context, in PolicyInput) (PolicyDecision, error)
}

// PolicyInput is the input to [PolicyEvaluator.Evaluate].
type PolicyInput struct {
	State           *State
	NextStep        string
	AssuranceLevels []string
	RequestedACR    *string
}

// PolicyDecision is the output of [PolicyEvaluator.Evaluate].
type PolicyDecision struct {
	// JumpToTerminal short-circuits to the named terminal step when set.
	JumpToTerminal *string

	// InjectGates lists additional gates to merge into the next step's
	// gates dictionary. Injected gates are indistinguishable from
	// admin-declared ones at the client.
	InjectGates map[string]GateRender
}
