package domain

import (
	"strings"
	"time"
)

const (
	FlowDefinitionPrefix ResourcePrefix = "flowdef"
)

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

// FlowOnSuccess names the server-side mutation that runs after a
// step's fields validate, before its transition fires. Nil on
// [FlowDefinitionStep.OnSuccess] means no side effect.
//
//go:generate go tool enumer -type FlowOnSuccess -transform snake -trimprefix FlowOnSuccess -sql
type FlowOnSuccess uint8

const (
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

// FlowActionKind classifies what the engine should do when a user invokes
// an action. Submit-style kinds run the input pipeline (field validation,
// challenge dispatch, on_success); Navigate skips the pipeline and just
// follows the matching transition.
//
//go:generate go tool enumer -type FlowActionKind -transform snake -trimprefix FlowActionKind -sql
type FlowActionKind uint8

const (
	// FlowActionKindUnset is the zero value. stepActionKind returns it
	// when the submitted name isn't declared on the step.
	FlowActionKindUnset FlowActionKind = iota
	// FlowActionKindSubmit advances by collecting the step's fields and
	// running the standard validate/dispatch/on_success pipeline.
	FlowActionKindSubmit
	// FlowActionKindPasskey issues a WebAuthn assertion challenge and
	// resolves the matching transition once the assertion verifies.
	FlowActionKindPasskey
	// FlowActionKindPasskeyRegister issues a WebAuthn registration
	// challenge and resolves the matching transition once the attestation
	// verifies.
	FlowActionKindPasskeyRegister
	// FlowActionKindNavigate routes through the transition without running
	// the input pipeline. Used for pure-routing actions declared in the flow
	// definition where the submitted fields are irrelevant.
	FlowActionKindNavigate
	// FlowActionKindBack pops the previous step from runtime history and
	// re-renders it. Injected by the engine on rendered step responses when
	// history is non-empty and the current step is non-terminal; rejected by
	// the validator on inbound flow definitions — flow authors never declare it.
	FlowActionKindBack
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

func NewFlowDefinition(
	flowDefID string,
	projectID string,
	name string,
	schemaVersion string,
	userSchema string,
	purposes map[FlowDefinitionPurpose]string,
	audience FlowDefinitionAudience,
	steps []FlowDefinitionStep,
	status FlowDefinitionStatus,
) (_ *FlowDefinition, err error) {
	return &FlowDefinition{
		ProjectID:     projectID,
		ID:            flowDefID,
		Name:          name,
		SchemaVersion: schemaVersion,
		Status:        status,
		UserSchema:    userSchema,
		Purposes:      purposes,
		Audience:      audience,
		Steps:         steps,
	}, nil
}

// InitialStepFor returns the entry-point step name for purpose, or
// false if the definition does not serve it.
func (d *FlowDefinition) InitialStepFor(purpose FlowDefinitionPurpose) (string, bool) {
	step, ok := d.Purposes[purpose]
	return step, ok
}

// FindStep returns a pointer into d.Steps for the step named name, or
// false if no such step exists.
func (d *FlowDefinition) FindStep(name string) (*FlowDefinitionStep, bool) {
	for i := range d.Steps {
		if d.Steps[i].Name == name {
			return &d.Steps[i], true
		}
	}
	return nil, false
}

// FlowDefinitionAudience describes which requests this definition should be selected for.
// Empty slices (or nil) mean "no restriction". Specificity for resolution
// is app > team > project-wide (both empty).
type FlowDefinitionAudience struct {
	AppIDs  []string
	TeamIDs []string
}

// authMethodPrefix marks a step.fields entry as referring to an entry
// under the user schema's `x-auth-methods` keyword (e.g.
// "x-auth-methods#password") rather than to a top-level user property.
const authMethodPrefix = "x-auth-methods#"

// Field carries the raw field name from a flow-definition step.
type Field string

// String returns the raw wire-format name.
func (f Field) String() string {
	return string(f)
}

// IsUserProperty reports whether the field names a top-level user-schema property.
func (f Field) IsUserProperty() bool {
	return !f.IsAuthMethod()
}

// IsAuthMethod reports whether the field references an `x-auth-methods` entry.
func (f Field) IsAuthMethod() bool {
	return strings.HasPrefix(f.String(), authMethodPrefix)
}

// AuthMethod returns the method name after the `x-auth-methods#` prefix (e.g. "password").
func (f Field) AuthMethod() string {
	return strings.TrimPrefix(f.String(), authMethodPrefix)
}

// FieldsFromStrings lifts wire-format string field names into typed
// [Field] values at the API/repository boundary.
func FieldsFromStrings(s []string) []Field {
	if s == nil {
		return nil
	}
	out := make([]Field, len(s))
	for i, v := range s {
		out[i] = Field(v)
	}
	return out
}

// FieldsToStrings lowers typed [Field] values back to wire-format
// strings at the API/repository boundary.
func FieldsToStrings(f []Field) []string {
	if f == nil {
		return nil
	}
	out := make([]string, len(f))
	for i, v := range f {
		out[i] = string(v)
	}
	return out
}

// FlowDefinitionStep is a single node in the step graph.
type FlowDefinitionStep struct {
	Name string
	// Fields lists the user-schema property names this step collects.
	// Resolved against [FlowDefinition.UserSchema] at runtime to derive
	// per-field type, validation, and implicit outcomes.
	Fields []Field
	// Actions are the user-selectable actions on this step, in display
	// order. Each action's Name is what the frontend echoes back in the
	// submit request.
	Actions []FlowStepAction
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
	Name string
	// Kind classifies how the engine handles this action. See
	// [FlowActionKind] for the available kinds.
	Kind    FlowActionKind
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

// FlowDefinitionField enumerates the fields of FlowDefinition which can be used for ordering in list operations.
type FlowDefinitionField uint8

const (
	FlowDefinitionFieldUnspecified FlowDefinitionField = iota
	FlowDefinitionFieldProjectID
	FlowDefinitionFieldID
	FlowDefinitionFieldName
	FlowDefinitionFieldSchemaVersion
	FlowDefinitionFieldStatus
	FlowDefinitionFieldCreatedAt
	FlowDefinitionFieldUpdatedAt
	FlowDefinitionFieldUserSchema
	FlowDefinitionFieldPurposes
	FlowDefinitionFieldAudience
	FlowDefinitionFieldSteps
)
