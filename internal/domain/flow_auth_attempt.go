package domain

import "context"

// FlowAuthAttemptService is the consumer-defined view the
// [FlowStateMachine] holds over the auth-attempt domain. It collapses
// the underlying two-phase issue-then-verify cycle of each challenge
// (see [internal/service.AuthAttemptService]) into a single Submit*
// call per field. The state machine never sees challenge IDs.
//
// Cookie I/O, OIDC redirect construction, and the final handoff stay
// with the HTTP handler and are deliberately absent.
type FlowAuthAttemptService interface {
	// Start opens a new auth attempt and returns its ID. Called from
	// [FlowStateMachine.Start]. The concrete impl delegates to
	// service.AuthAttemptService.Create, which is named after the
	// resource lifecycle ("create the row"); we name the consumer-side
	// method after the state-machine event ("start the attempt") to
	// avoid a method-name collision on the production type that
	// satisfies both interfaces.
	Start(ctx context.Context, in FlowCreateAttemptInput) (attemptID string, err error)

	// SubmitIdentifier resolves the submitted identifier value (email,
	// username, phone) against the user catalog and records the match on
	// the attempt. Returns the resolved user id. A no-match surfaces as
	// [ErrAuthAttemptProofRejected] (use [errors.Is]); the state machine
	// maps that to the [FlowImplicitOutcomeUserNotFound] outcome.
	SubmitIdentifier(ctx context.Context, in FlowSubmitIdentifierInput) (userID string, err error)

	// SubmitPassword verifies the plaintext password against the
	// previously-resolved user on the attempt. An incorrect password
	// surfaces as [ErrAuthAttemptProofRejected]; the state machine
	// surfaces this as a step-level error and keeps the user on the
	// current step.
	SubmitPassword(ctx context.Context, in FlowSubmitPasswordInput) error
}

// FlowCreateAttemptInput names what the state machine hands to
// [FlowAuthAttemptService.Create] when bootstrapping a flow.
//
// SessionID is set only for step-up authentication against an existing
// session; nil for fresh sign-in / registration. RequiredChecks
// overrides the project default when the flow definition pins them.
type FlowCreateAttemptInput struct {
	ProjectID      string
	SessionID      *string
	RequiredChecks []AuthCheckType
}

// FlowSubmitIdentifierInput carries the identifier value the user
// submitted on the current step.
type FlowSubmitIdentifierInput struct {
	ProjectID string
	AttemptID string
	Value     string
}

// FlowSubmitPasswordInput carries the plaintext password the user
// submitted on the current step.
type FlowSubmitPasswordInput struct {
	ProjectID string
	AttemptID string
	Plain     string
}
