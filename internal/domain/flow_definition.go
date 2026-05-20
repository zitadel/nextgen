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

// FlowOnSuccess names the server-side mutation that runs after a step's
// fields validate and before its transition fires. Empty (pointer nil
// on [FlowDefinitionStep.OnSuccess]) means no side effect — advance
// directly on the submitted action.
//
//go:generate go tool enumer -type FlowOnSuccess -transform snake -trimprefix FlowOnSuccess -sql
type FlowOnSuccess uint8

const (
	// FlowOnSuccessCreateUser materializes the user record from the
	// step's collected fields. Used by register flows.
	FlowOnSuccessCreateUser FlowOnSuccess = iota
)

// FlowStepComplete classifies a terminal step. The frontend uses this
// to decide between navigating to a protocol redirect URI or rendering
// a success/info screen. Set on [FlowDefinitionStep.Complete] to mark
// the step as terminal; nil for regular interactive steps.
//
//go:generate go tool enumer -type FlowStepComplete -transform snake -trimprefix FlowStepComplete -sql
type FlowStepComplete uint8

const (
	// FlowStepCompleteRedirect navigates the client to the protocol
	// redirect URI (typically the OIDC/SAML callback).
	FlowStepCompleteRedirect FlowStepComplete = iota
	// FlowStepCompleteShow renders the step as a success or info screen.
	FlowStepCompleteShow
)

//go:generate go tool enumer -type FlowDefinitionTransitionAction -transform snake -trimprefix FlowDefinitionTransitionAction -sql
type FlowDefinitionTransitionAction uint8

const (
	// Switch means switching to a new flow. Redirect the user to a new flow
	Switch FlowDefinitionTransitionAction = iota
	// Pivot means switching temporarily to a new flow, then comes back to current flow once done
	Pivot
)

//go:generate go tool enumer -type FlowGateKind -transform snake -trimprefix FlowGateKind -sql
type FlowGateKind uint8

const (
	// FlowGateKindCaptcha challenges the user with a bot-detection
	// provider (altcha, turnstile, hcaptcha, etc).
	FlowGateKindCaptcha FlowGateKind = iota
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
	// Purposes maps each purpose this definition handles to the name of
	// its entry-point step. Every value must match a step in [Steps].
	Purposes map[FlowDefinitionPurpose]string
	Audience FlowDefinitionAudience
	Steps    []FlowDefinitionStep
}

// FlowDefinitionAudience describes which requests this definition should be selected for.
// Empty slices (or nil) mean "no restriction". Specificity for resolution
// is app > team > project-wide (both empty).
type FlowDefinitionAudience struct {
	AppIDs  []string
	TeamIDs []string
}

// FlowDefinitionStep is a single node in the step graph.
type FlowDefinitionStep struct {
	Name string
	// Fields lists the user-schema property names this step collects.
	// Resolved against [FlowDefinition.UserSchema] at runtime to derive
	// per-field type, validation, and implicit outcomes.
	Fields []string
	// Actions are the user-selectable actions on this step, keyed by the
	// name the frontend echoes back in the submit request.
	Actions map[string]FlowStepAction
	// Gates are security challenges that must be satisfied before the
	// step's submission is accepted, keyed by gate name.
	Gates map[string]FlowStepGate
	// SSOProviders lists the identity providers available on this step.
	SSOProviders []FlowSSOProvider
	// OnSuccess names the server-side mutation to run after field
	// validation passes, before the transition fires. Nil means advance
	// directly with no side effect.
	OnSuccess *FlowOnSuccess
	// Complete, when non-nil, marks this step as terminal and dictates
	// how the frontend finishes (redirect vs. success screen). Nil for
	// regular interactive steps.
	Complete *FlowStepComplete
	// Transitions maps an action or engine-emitted outcome name to the
	// next state. The key is either an action declared in [Actions] or a
	// reserved outcome the engine produces (e.g. `user_not_found`,
	// `callback`).
	Transitions map[string]FlowStepTransition
}

// FlowStepAction is a user-selectable action declared on a step.
type FlowStepAction struct {
	TextKey string
	Primary bool
}

// FlowStepGate is a security challenge attached to a step.
type FlowStepGate struct {
	Kind     FlowGateKind
	Provider string
	// Config is provider-specific challenge configuration, opaque to the engine.
	Config map[string]any
}

// FlowSSOProvider is an identity provider option offered on a step.
type FlowSSOProvider struct {
	ID       string
	Name     string
	Template string
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
