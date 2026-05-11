package flow

import (
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// State is the runtime state of a single in-flight flow. It is serialized
// into the `_zflow` cookie via [CookieCodec] and threaded through every
// [StateMachine] call.
type State struct {
	SessionID      string
	SessionVersion int64
	DefinitionID   string
	Purpose        domain.FlowDefinitionPurpose
	CurrentStep    string
	StepVersion    int64
	History        []string
	PivotStack     []Frame
	CollectedData  map[string]any
	AuthRequestID  *string
	RedirectURI    *string
	RequestedACR   *string
	IssuedAt       time.Time
}

// Frame is one entry on the pivot stack. When a flow pivots into another
// flow, the parent's resume point is pushed as a Frame; on completion the
// state machine pops it and re-renders the parent's next step.
type Frame struct {
	DefinitionID  string
	Purpose       domain.FlowDefinitionPurpose
	CurrentStep   string
	History       []string
	CollectedData map[string]any
}

// SessionRef points at the session this flow is bound to.
type SessionRef struct {
	ID      string
	Version int64
}

// AuthRequestRef carries OIDC/SAML auth-request context when the flow was
// initiated by a downstream protocol handler.
type AuthRequestRef struct {
	ID          string
	RedirectURI string
	ACR         *string
}

// Step is the capability payload returned to the client for the next visible
// step. It is the runtime projection of a [domain.FlowDefinitionStep] — what
// to render and what the user can do, after schema resolution and gate
// issuance.
type Step struct {
	Name         string
	Complete     *string
	RedirectURL  *string
	Error        *string
	Fields       map[string]Field
	Actions      map[string]Action
	Gates        map[string]GateRender
	SSOProviders []SSOProvider
}

// Field is a resolved input field for the current step, derived from the
// flow's user schema.
type Field struct {
	Type       string
	TextKey    string
	Required   bool
	Validation map[string]any
	Behavior   FieldBehavior
}

// FieldBehavior captures the schema extensions that drive engine behavior.
type FieldBehavior struct {
	IsIdentifier bool   // x-identifier
	Credential   string // x-credential value; "" = none
	Unique       bool   // x-unique
}

// Action is a user-initiated transition available on the current step.
type Action struct {
	TextKey string
	Primary bool
}

// GateRender is the per-render output for a gate: whether it must be
// satisfied and the provider-specific config the client widget needs.
type GateRender struct {
	Type      GateType
	Provider  string
	Required  bool
	Satisfied bool
	Config    map[string]any
}

// SSOProvider is an identity-provider option offered on the current step.
type SSOProvider struct {
	ID       string
	Name     string
	Template string
}
