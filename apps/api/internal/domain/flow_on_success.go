package domain

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
