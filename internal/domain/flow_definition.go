package domain

import "time"

type FlowDefinitionStatus string

const (
	FlowDefinitionStatusDraft      FlowDefinitionStatus = "draft"
	FlowDefinitionStatusActive     FlowDefinitionStatus = "active"
	FlowDefinitionStatusDeprecated FlowDefinitionStatus = "deprecated"
	FlowDefinitionStatusArchived   FlowDefinitionStatus = "archived"
)

type FlowDefinitionPurpose string

const (
	FlowDefinitionPurposeLogin       FlowDefinitionPurpose = "login"
	FlowDefinitionPurposeRegister    FlowDefinitionPurpose = "register"
	FlowDefinitionPurposeRecovery    FlowDefinitionPurpose = "recovery"
	FlowDefinitionPurposeProfiling   FlowDefinitionPurpose = "profiling"
	FlowDefinitionPurposeReauth      FlowDefinitionPurpose = "reauth"
	FlowDefinitionPurposeLinkAccount FlowDefinitionPurpose = "link_account"
)

type FlowStepType string

const (
	FlowStepTypeIdentifier   FlowStepType = "identifier"
	FlowStepTypeCredential   FlowStepType = "credential"
	FlowStepTypeForm         FlowStepType = "form"
	FlowStepTypeVerification FlowStepType = "verification"
	FlowStepTypePolicyCheck  FlowStepType = "policy_check"
	FlowStepTypeAction       FlowStepType = "action"
	FlowStepTypeConsent      FlowStepType = "consent"
	FlowStepTypeCaptcha      FlowStepType = "captcha"
	FlowStepTypeRedirect     FlowStepType = "redirect"
	FlowStepTypeInfo         FlowStepType = "info"
	FlowStepTypeComplete     FlowStepType = "complete"
)

// FlowDefinition is a customer-configured directed graph of authentication steps.
// It is immutable: modifications produce a new revision with a new SchemaVersion.
type FlowDefinition struct {
	InstanceID    string
	ID            string
	Name          string
	EngineVersion string
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
// Fields are applied with specificity: AppID > OrgID > SchemaID > IsInstanceDefault.
type FlowDefinitionAudience struct {
	AppID             *string
	OrgID             *string
	SchemaID          *string
	IsInstanceDefault bool
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
