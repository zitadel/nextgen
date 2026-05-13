package domain

// FlowState is the runtime state of a single in-flight flow. The handler
// JSON-encodes it as the payload of the sealed `_zflow` cookie on every
// response and decodes it back on every incoming request. Issued-at
// metadata is the sealer's concern, not part of FlowState.
//
// FlowState embeds FlowProgress: the active progress (definition, step,
// history, collected data) sits at the root, and any paused parents
// live on PivotStack. The remaining fields are session/OIDC context
// that only makes sense at the top level.
type FlowState struct {
	// FlowProgress is the user's current progress: which definition is
	// running, which step is being shown, and what's been collected so
	// far. Promoted to the top level so callers read e.g.
	// state.CurrentStep directly.
	FlowProgress

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

	// CurrentStep is the name of the step the user is currently on
	// within DefinitionID. The next submit is interpreted against this
	// step.
	CurrentStep string

	// History is the ordered list of step names visited within this
	// progress entry (excluding any parents on PivotStack). Used for
	// `back` navigation and diagnostics.
	History []string

	// CollectedData accumulates submitted field values for this
	// progress entry, keyed by schema property name. A child flow's
	// CollectedData is discarded when its progress is popped.
	CollectedData map[string]any
}
