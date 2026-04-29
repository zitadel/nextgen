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
// Fields are applied with specificity: AppID > TeamID > SchemaID > IsProjectDefault.
type FlowDefinitionAudience struct {
	AppID            *string
	TeamID           *string
	SchemaID         *string
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
	Action       string
	TargetStep   *string
	PivotPurpose *FlowDefinitionPurpose
}
