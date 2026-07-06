package domain

import "time"

// FlowState is the runtime state of a single in-flight flow. The handler
// JSON-encodes it as the payload of the sealed `_zflow` cookie on every
// response and decodes it back on every incoming request.
//
// FlowState embeds FlowProgress: the active progress (definition, step,
// history, collected data) sits at the root, and any paused parents
// live on PivotStack. The remaining fields are session/OIDC context
// that only makes sense at the top level.
type FlowState struct {
	// ID is the flow handle minted at Start. The handler verifies it
	// matches the path (`/flow/{id}/...`) to reject path/cookie mismatches.
	ID string

	// ProjectID scopes the flow to a single tenant.
	ProjectID string

	// UserSchemaURL is the user schema this flow validates against,
	// captured at Start time so a mid-flow default change doesn't
	// reshape in-flight data.
	UserSchemaURL string

	// FlowProgress is the user's current progress: which definition is
	// running, which step is being shown, and what's been collected so
	// far. Promoted to the top level so callers read e.g.
	// state.CurrentStep directly.
	FlowProgress

	// IssuedAt is when this state was last sealed into the cookie. The
	// handler refuses to open a state older than the configured max-age,
	// bounding how long a stolen cookie remains replayable. Refreshed on
	// every advance.
	IssuedAt time.Time

	// SessionID is the stable identifier of the user session backing this
	// flow. It survives pivots — child and parent flows share it.
	SessionID string

	// SessionVersion pins the session row version observed when this flow
	// was last advanced. The state machine refuses to process a submit
	// against a stale version (e.g. another tab logged out the session).
	SessionVersion int64

	// StepVersion pins the step revision observed when CurrentStep was
	// emitted. If the definition is republished mid-flow, the state
	// machine surfaces an integrity error rather than silently applying
	// the new step shape to in-flight data.
	StepVersion int64

	// PivotStack records parent-flow resume points. When a flow pivots
	// into another flow, the parent's FlowProgress is pushed; on the
	// child's completion the state machine pops and re-renders the
	// parent's next step. Empty for non-stacked flows.
	PivotStack []FlowProgress

	// AuthRequestID, when set, identifies the OIDC authorization request
	// this flow is fulfilling. Nil for flows started outside an OIDC
	// context (e.g. standalone registration or recovery).
	AuthRequestID *string

	// RedirectURI is the terminal redirect destination for `complete:
	// redirect` flows (typically the OIDC callback). Nil for `complete:
	// show` flows that end on a success screen.
	RedirectURI *string

	// RequestedACR is the Authentication Context Class Reference asked
	// for by the relying party. The implicit policy evaluator compares
	// it against the session's assurance levels to decide whether the
	// flow can complete.
	RequestedACR *string

	// PendingChallenge binds an outstanding ceremony (passkey today,
	// other methods later) to the current step. Set by the state
	// machine when entering a step that declares a challenge; cleared
	// once the matching ChallengeResponse verifies. Nil when no
	// ceremony is in flight.
	PendingChallenge *FlowPendingChallenge

	// AuthAttemptID names the auth_attempts row this flow is collecting
	// factors against. Created at Start; completed intrinsically by the
	// last successful Submit* call; handed off by the API handler at
	// the OIDC redirect boundary.
	AuthAttemptID string
}

// FlowPendingChallenge records the server-issued challenge the next
// submit must satisfy. The binding (id + method) is threaded through the
// cookie so the verify step can locate it; Options carries the
// client-facing ceremony options so a GET /flow re-render can re-emit
// them without re-issuing.
type FlowPendingChallenge struct {
	// ID is the challenge identifier returned by the auth-attempt
	// service at issue time. The client echoes it back in
	// ChallengeResponse.
	ID string

	// Method names the ceremony kind (e.g. "passkey"). The state
	// machine uses it to route verification to the right service.
	Method string

	// Options is the client-facing ceremony options JSON (for passkey,
	// the PublicKeyCredentialRequestOptions). Surfaced on the rendered
	// step's challenge so the browser can run the ceremony; persisted in
	// the cookie so a re-render re-emits it.
	Options []byte

	// IssuedAt is when the challenge was minted. The auth-attempt
	// service enforces its own freshness window; this field is kept for
	// diagnostics and for the state machine to short-circuit obviously
	// stale challenges before calling Verify.
	IssuedAt time.Time
}

// FlowProgress captures the user's position within a single flow
// definition: which definition is running, the current step, the
// history of steps visited so far, and the data submitted along the
// way. It is embedded in FlowState for the active flow and pushed onto
// FlowState.PivotStack for paused parents.
type FlowProgress struct {
	// DefinitionID is the flow definition currently being executed. On
	// pivot it changes to the child definition; on pop it is restored
	// from the parent entry on PivotStack.
	DefinitionID string

	// Purpose is the kind of flow (login, signup, recovery, …). The
	// handler uses it to surface a coarse classification without parsing
	// the definition.
	Purpose FlowDefinitionPurpose

	// CurrentPurpose is the dynamic dispatch mode. Flips on identifier
	// outcomes; Purpose stays pinned for telemetry / ACR.
	CurrentPurpose FlowDefinitionPurpose

	// CurrentStep is the name of the step the user is currently on
	// within DefinitionID. The next submit is interpreted against this
	// step.
	CurrentStep string

	// History is the append-only audit trail of visited steps.
	History []string

	// BackStack maintains the history of visited steps, but gets
	// cleared after an irreversible action.
	// The engine also uses it to decide when an action.back should
	// be injected into the response.
	BackStack []FlowBackEntry

	// CollectedData accumulates submitted field values for this
	// progress entry, keyed by schema property name. A child flow's
	// CollectedData is discarded when its progress is popped.
	CollectedData CollectedFlowData
}

// FlowBackEntry holds an entry to be pushed into BackStack.
type FlowBackEntry struct {
	StepName string
	// Purpose is kept in the history so the flow returns with the current purpose.
	Purpose FlowDefinitionPurpose
}

// ClearBackStack drops any accumulated back-navigation entries. Called
// past irreversible mutations and at flow termination.
func (s *FlowState) ClearBackStack() {
	s.BackStack = nil
}

// PeekBackStack returns the top BackStack entry without mutating the
// state. Returns false when the stack is empty.
func (s *FlowState) PeekBackStack() (FlowBackEntry, bool) {
	n := len(s.BackStack) - 1
	if n < 0 {
		return FlowBackEntry{}, false
	}
	return s.BackStack[n], true
}

// PopBackStack removes and returns the top BackStack entry. Returns
// false when the stack is empty, leaving the state untouched.
func (s *FlowState) PopBackStack() (FlowBackEntry, bool) {
	prev, ok := s.PeekBackStack()
	if !ok {
		return FlowBackEntry{}, false
	}
	s.BackStack = s.BackStack[:len(s.BackStack)-1]
	return prev, true
}

// ClearPendingChallenge drops any outstanding ceremony binding on the
// state. Called when the challenge is superseded (verify succeeded, or
// the user navigated away).
func (s *FlowState) ClearPendingChallenge() {
	s.PendingChallenge = nil
}

type CollectedFlowData struct {
	UserData    map[string]any
	UserID      string
	AuthMethods CollectedAuthMethodData
}

type CollectedAuthMethodData struct {
	Password                       string
	HasProvisionedUserIDForPasskey bool
}
