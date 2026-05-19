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
	// UserSchema is the URL of the JSON schema this flow operates on.
	UserSchema string
	// Purposes collapses the OpenAPI `purposes` array and `initial_steps`
	// map into a single slice of (Purpose, InitialStep) tuples.
	Purposes []FlowDefinitionPurposeEntry
	Audience FlowDefinitionAudience
	Steps    []FlowDefinitionStep
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
	Name        string
	Type        FlowStepType
	Config      map[string]any
	Transitions []FlowStepTransition
}

// FlowStepTransition maps an action name to either a target step (regular) or a pivot purpose.
type FlowStepTransition struct {
	Action *FlowDefinitionTransitionAction
	// Target is either a step in the current flow OR a new flow.
	// When Action == nil, Target refers to a step in the current flow
	// When Action != nil, Target refers to another flow.
	Target string
}

func (fst FlowStepTransition) IsCurrentFlow() bool {
	return fst.Action == nil
}
