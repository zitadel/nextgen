package domain

import (
	"context"
)

// FlowOnSuccessHandler is the contract every on_success mutation
// satisfies. The state machine calls Handle after a step's fields
// validate and before its transition fires.
//
// Each [FlowOnSuccess] value maps to one handler. Implementations live
// in their own file (e.g. flow_on_success_create_user.go).
type FlowOnSuccessHandler interface {
	Handle(ctx context.Context, in FlowOnSuccessInput) (FlowOnSuccessResult, error)
}

// ManifestForOnSuccess returns the credential kinds a mutation establishes.
// Dispatch (verify-vs-skip) and the validator (upstream-collects check)
// both read this table.
func ManifestForOnSuccess(o FlowOnSuccess) []FlowFieldChallenge {
	switch o {
	case FlowOnSuccessCreateUser:
		return []FlowFieldChallenge{FlowFieldChallengeIdentifier, FlowFieldChallengePassword}
	}
	return nil
}

// FlowOnSuccessInput is the per-call context the state machine threads
// into a handler.
type FlowOnSuccessInput struct {
	ProjectID     string
	UserSchemaURL string
	Fields        map[string]any
	Resolved      FlowResolvedFields
	State         *FlowState
	ResolvedFlow  *FlowDefinition
}

// FlowOnSuccessResult is what a handler returns. StepError keeps the
// user on the current step.
type FlowOnSuccessResult struct {
	StepError *string
	// UserID is set when a handler creates a new user. The state machine
	// only records it in flow state — a handler returning a UserID MUST
	// have persisted the user's verified factors on the auth attempt
	// inside its own transaction (see FlowCreateUserWithPasswordHandler's
	// recordAttemptFactorsAction), or the exchanged session will be bound
	// to a user with no factors.
	UserID string
	// Irreversible flags mutations the user cannot reverse (e.g. created a user).
	Irreversible bool
}
