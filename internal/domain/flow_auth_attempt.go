package domain

import (
	"context"
	"errors"
)

// FlowAuthAttemptService is the consumer-defined view the
// [FlowStateMachine] holds over the auth-attempt domain. The state
// machine owns the attempt lifecycle (Start at flow start, Complete at
// the terminal step) and routes per-submit field values into the
// matching challenge.
//
// Cookie I/O, OIDC redirect construction, and the final Handoff stay
// with the HTTP handler and are deliberately absent.
type FlowAuthAttemptService interface {
	Start(ctx context.Context, in FlowStartAttemptInput) (*AuthAttempt, error)
	ResolveIdentifier(ctx context.Context, in FlowResolveIdentifierInput) (FlowResolvedIdentifier, error)
	VerifyPassword(ctx context.Context, in FlowVerifyPasswordInput) error
	Complete(ctx context.Context, projectID, attemptID string) error
}

// FlowStartAttemptInput is what the state machine hands to
// [FlowAuthAttemptService.Start] when bootstrapping a flow.
//
// SessionID is set only for step-up authentication against an existing
// session; nil for fresh sign-in / registration. RequiredChecks
// overrides the project default when the flow definition pins them.
type FlowStartAttemptInput struct {
	ProjectID      string
	SessionID      *string
	RequiredChecks []AuthCheckType
}

// FlowResolveIdentifierInput names the identifier value submitted on
// the current step.
type FlowResolveIdentifierInput struct {
	ProjectID string
	AttemptID string
	Value     string
}

// FlowResolvedIdentifier names the user matched by an identifier
// submission. Returned by [FlowAuthAttemptService.ResolveIdentifier].
type FlowResolvedIdentifier struct {
	UserID string
}

// FlowVerifyPasswordInput carries the plaintext password submission and
// the previously-resolved user it must verify against.
type FlowVerifyPasswordInput struct {
	ProjectID string
	AttemptID string
	UserID    string
	Plain     string
}

// ErrFlowIdentifierUnknown reports that no user matched the submitted
// identifier. The state machine maps this to the
// [FlowImplicitOutcomeUserNotFound] routing outcome.
var ErrFlowIdentifierUnknown = errors.New("flow auth attempt: identifier not resolved")

// ErrFlowPasswordInvalid reports that the submitted password did not
// verify against the resolved user. The state machine surfaces this as
// a step-level error and keeps the user on the same step.
var ErrFlowPasswordInvalid = errors.New("flow auth attempt: password rejected")
