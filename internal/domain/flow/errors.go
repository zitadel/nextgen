package flow

import "errors"

// Selector errors.
var (
	// ErrFlowNotFound is returned by [Selector] when a direct lookup by name
	// does not match any definition.
	ErrFlowNotFound = errors.New("flow: definition not found")

	// ErrPurposeMismatch is returned by [Selector] when a direct lookup
	// matches a definition that does not serve the requested purpose.
	ErrPurposeMismatch = errors.New("flow: definition does not serve requested purpose")

	// ErrAmbiguous is reserved for future use when explicit priority fields
	// are added to selection. The MVP tie-break is total and never returns
	// this error.
	ErrAmbiguous = errors.New("flow: multiple definitions match with equal specificity")
)

// State machine errors.
var (
	// ErrInvalidAction is returned by [StateMachine] when a submission's
	// action is not declared on the current step.
	ErrInvalidAction = errors.New("flow: action not declared on current step")

	// ErrSessionConflict signals an optimistic-lock failure against the
	// session backing this flow. The handler maps it to HTTP 409.
	ErrSessionConflict = errors.New("flow: session version conflict")

	// ErrIntegrity is returned when the engine encounters a state that
	// should have been caught at definition-validation time (missing
	// target step, unknown gate, etc.). The handler maps it to HTTP 500.
	ErrIntegrity = errors.New("flow: definition integrity violation")
)

// Cookie codec errors.
var (
	// ErrExpired is returned by [CookieCodec.Decode] when the cookie's
	// issued-at timestamp is outside the configured max-age window.
	ErrExpired = errors.New("flow: cookie expired")

	// ErrInvalidCookie is returned by [CookieCodec.Decode] for any
	// integrity or format failure (tag mismatch, unknown version byte,
	// malformed payload).
	ErrInvalidCookie = errors.New("flow: cookie integrity check failed")
)

// Auth-attempt service errors.
var (
	// ErrInvalidProof signals a verification failure on a credential
	// challenge. The state machine surfaces it as a step-level error.
	ErrInvalidProof = errors.New("flow: credential proof invalid")

	// ErrUserNotFound drives the reserved `user_not_found` transition.
	ErrUserNotFound = errors.New("flow: user not found")

	// ErrRateLimited signals that the attempt is being throttled. The
	// state machine surfaces it without advancing.
	ErrRateLimited = errors.New("flow: rate limited")
)

// Gate errors.
var (
	// ErrUnknownGate is returned by [GateRegistry] when no implementation
	// is registered for the requested (type, provider) pair.
	ErrUnknownGate = errors.New("flow: gate not registered")

	// ErrGateProofInvalid is returned by [Gate.Verify] when the submitted
	// proof does not pass.
	ErrGateProofInvalid = errors.New("flow: gate proof invalid")
)
