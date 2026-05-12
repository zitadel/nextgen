package domain

// FlowState is the runtime state of a single in-flight flow. The handler
// JSON-encodes it as the payload of the sealed `_zflow` cookie on every
// response and decodes it back on every incoming request. Issued-at
// metadata is the sealer's concern, not part of FlowState.
type FlowState struct {
	SessionID      string
	SessionVersion int64
	DefinitionID   string
	Purpose        FlowDefinitionPurpose
	CurrentStep    string
	StepVersion    int64
	History        []string
	PivotStack     []FlowFrame
	CollectedData  map[string]any
	AuthRequestID  *string
	RedirectURI    *string
	RequestedACR   *string
}

// FlowFrame is one entry on the pivot stack. When a flow pivots into
// another flow, the parent's resume point is pushed as a FlowFrame; on
// completion the state machine pops it and re-renders the parent's next
// step.
type FlowFrame struct {
	DefinitionID  string
	Purpose       FlowDefinitionPurpose
	CurrentStep   string
	History       []string
	CollectedData map[string]any
}
