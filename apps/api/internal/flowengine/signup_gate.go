package flowengine

import (
	"github.com/zitadel/nextgen/internal/domain"
)

// announceSignupGate announces the sign-up gate on a step whose next submit
// spends the sign-up proof: one whose on_success declares it, or one carrying a
// passkey registration that creates its user. Runtime enforcement does not
// depend on template markup or client-selected purpose. The step is looked up
// in def, the definition of the flow active in the result's state.
func announceSignupGate(def *domain.FlowDefinition, result *StepResult) {
	if result.Step == nil || result.State == nil {
		return
	}
	step, ok := def.FindStep(result.Step.Name)
	if ok && step.OnSuccessSpec().SpendsSignupProof {
		result.Step.SignupRequired = true
		return
	}
	result.Step.SignupRequired = registrationCreatesUser(result)
}

// registrationCreatesUser reports whether the step carries a passkey
// registration that creates its user, which its attestation spends the
// sign-up proof for. The pending challenge records that at issue.
func registrationCreatesUser(result *StepResult) bool {
	challenge := result.Step.Challenge
	if challenge == nil || challenge.Method != ChallengeMethodPasskeyRegister {
		return false
	}
	pending := result.State.PendingChallenge
	return pending != nil && pending.ID == challenge.ChallengeID && pending.Provisional
}
