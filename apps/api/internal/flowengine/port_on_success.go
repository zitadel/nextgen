package flowengine

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

// FlowOnSuccessHandler applies the create_user mutation. The state machine
// calls Handle after a step's fields validate and before its transition
// fires; create_user_with_sso writes through [FlowSSOIdentityService].
type FlowOnSuccessHandler interface {
	Handle(ctx context.Context, in FlowOnSuccessInput) (FlowOnSuccessResult, error)
}

// FlowOnSuccessInput is the per-call context the state machine threads
// into a handler.
type FlowOnSuccessInput struct {
	GateProofs    map[string]string
	ProjectID     string
	UserSchemaURL string
	Fields        map[string]any
	Resolved      domain.FlowResolvedFields
	State         *FlowState
	ResolvedFlow  *domain.FlowDefinition
}

// FlowOnSuccessResult is what a handler returns. StepError keeps the
// user on the current step.
type FlowOnSuccessResult struct {
	StepError *domain.FlowStepFailure
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
