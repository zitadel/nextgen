package domain

import (
	"context"
)

// FlowOnSuccessHandler applies the create_user mutation. The state machine
// calls Handle after a step's fields validate and before its transition
// fires; create_user_with_sso writes through [FlowSSOIdentityService].
type FlowOnSuccessHandler interface {
	Handle(ctx context.Context, in FlowOnSuccessInput) (FlowOnSuccessResult, error)
}

// FlowOnSuccessSpec declares what a [FlowOnSuccess] mutation needs and how
// the step that runs it behaves. The validator and the flow engine both read it.
type FlowOnSuccessSpec struct {
	// Manifest lists the credential kinds the mutation establishes; each must
	// be collected on the step or upstream.
	Manifest []FlowFieldChallenge
	// SpendsSignupProof marks a mutation that creates a user from the submitted
	// values: the step announces the sign-up gate and its submission carries the proof.
	SpendsSignupProof bool
	// ProviderIdentity marks a step whose values describe the identity an
	// external provider returned, not a sign-in.
	ProviderIdentity bool
}

// flowOnSuccessSpecs holds one declaration per [FlowOnSuccess] value.
var flowOnSuccessSpecs = map[FlowOnSuccess]FlowOnSuccessSpec{
	FlowOnSuccessCreateUser: {
		Manifest:          []FlowFieldChallenge{FlowFieldChallengeIdentifier, FlowFieldChallengePassword},
		SpendsSignupProof: true,
	},
	FlowOnSuccessCreateUserWithSso: {
		ProviderIdentity: true,
	},
}

// OnSuccessSpec returns the declaration of the step's on_success mutation,
// or the zero spec when the step runs none.
func (s *FlowDefinitionStep) OnSuccessSpec() FlowOnSuccessSpec {
	if s.OnSuccess == nil {
		return FlowOnSuccessSpec{}
	}
	return flowOnSuccessSpecs[*s.OnSuccess]
}

// FlowOnSuccessInput is the per-call context the state machine threads
// into a handler.
type FlowOnSuccessInput struct {
	GateProofs    map[string]string
	ProjectID     string
	UserSchemaURL string
	Fields        map[string]any
	Resolved      FlowResolvedFields
	State         *FlowState
	ResolvedFlow  *FlowDefinition
}

// FlowOnSuccessResult is what a handler returns. StepError keeps the
// user on the current step.
type FlowOnSuccessResult struct {
	StepError *FlowStepFailure
	// UserID is set when a handler creates a new user. The state machine
	// only records it in flow state — a handler returning a UserID MUST
	// have persisted the user's verified factors on the auth attempt
	// inside its own transaction (see FlowCreateUserWithPasswordHandler's
	// recordAttemptFactorsAction), or the exchanged session will be bound
	// to a user with no factors.
	UserID string
	// Irreversible flags mutations the user cannot reverse (e.g. created a user).
	Irreversible bool
}
