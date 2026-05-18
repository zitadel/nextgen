package domain

import "time"

//go:generate go tool enumer -type FlowDefinitionStatus -transform snake -trimprefix FlowDefinitionStatus -sql
type FlowDefinitionStatus uint8

const (
	FlowDefinitionStatusDraft FlowDefinitionStatus = iota
	FlowDefinitionStatusActive
	FlowDefinitionStatusDeprecated
	FlowDefinitionStatusArchived
)

//go:generate go tool enumer -type FlowDefinitionPurpose -transform snake -trimprefix FlowDefinitionPurpose -sql
type FlowDefinitionPurpose uint8

const (
	FlowDefinitionPurposeLogin FlowDefinitionPurpose = iota
	FlowDefinitionPurposeRegister
	FlowDefinitionPurposeRecovery
	FlowDefinitionPurposeProfiling
	FlowDefinitionPurposeReauth
	FlowDefinitionPurposeLinkAccount
)

//go:generate go tool enumer -type FlowStepType -transform snake -trimprefix FlowStepType -sql
type FlowStepType uint8

const (
	FlowStepTypeIdentifier FlowStepType = iota
	FlowStepTypeCredential
	FlowStepTypeForm
	FlowStepTypeVerification
	FlowStepTypePolicyCheck
	FlowStepTypeAction
	FlowStepTypeConsent
	FlowStepTypeCaptcha
	FlowStepTypeRedirect
	FlowStepTypeInfo
	FlowStepTypeComplete
)

//go:generate go tool enumer -type FlowDefinitionTransitionAction -transform snake -trimprefix FlowDefinitionTransitionAction -sql
type FlowDefinitionTransitionAction uint8

const (
	// Switch means switching to a new flow. Redirect the user to a new flow
	Switch FlowDefinitionTransitionAction = iota
	// Pivot means switching temporarily to a new flow, then comes back to current flow once done
	Pivot
)

// FlowDefinition is a customer-configured directed graph of authentication steps.
// It is immutable: modifications produce a new revision with a new SchemaVersion.
type FlowDefinition struct {
	ProjectID     string
	ID            string
	Name          string
	SchemaVersion string
	Status        FlowDefinitionStatus
	CreatedAt     time.Time
	UpdatedAt     time.Time
	Purposes      []FlowDefinitionPurposeEntry
	Audience      FlowDefinitionAudience
	Steps         []FlowDefinitionStep
}

// FlowDefinitionPurposeEntry maps a purpose to its entry-point step within the definition.
type FlowDefinitionPurposeEntry struct {
	Purpose     FlowDefinitionPurpose
	InitialStep string
}

// FlowDefinitionAudience describes which requests this definition should be selected for.
// Fields are applied with specificity: AppID > TeamID > UserSchemaID > IsProjectDefault.
type FlowDefinitionAudience struct {
	AppID            *string
	TeamID           *string
	UserSchemaID     *string
	IsProjectDefault bool
}

// FlowDefinitionStep is a single node in the step graph.
type FlowDefinitionStep struct {
	Name string
	Type FlowStepType
	// OnSuccess names the [FlowOnSuccessHandler] the state machine
	// invokes after field validation. Empty means no handler — the
	// state machine advances on the submitted action directly.
	OnSuccess string
	Config    map[string]any
	// Transitions maps an outcome name (e.g. "submit", "user_not_found",
	// "register") to its destination. Outcomes come from three sources:
	// user-submitted action names declared in the step's `actions` dict,
	// implicit outcomes derived from schema annotations (e.g.
	// `user_not_found` from `x-identifier`), and engine-emitted events
	// (e.g. `sso`, `callback`). Keys are unique per step.
	Transitions map[string]FlowStepTransition
}

// FlowStepTransition is the destination of a transition. The outcome
// that triggers it is the map key in [FlowDefinitionStep.Transitions].
type FlowStepTransition struct {
	// Action selects how Target is interpreted:
	//   nil   — Target is a step name in the current flow.
	//   Switch — Target is another flow definition; replace the current flow.
	//   Pivot — Target is another flow definition; push and resume on pop.
	Action *FlowDefinitionTransitionAction

	// Target is either a step in the current flow (when Action == nil)
	// or a flow definition name (when Action is Switch or Pivot).
	Target string
}

func (fst FlowStepTransition) IsCurrentFlow() bool {
	return fst.Action == nil
}
