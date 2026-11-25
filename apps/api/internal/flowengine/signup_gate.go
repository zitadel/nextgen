package flowengine

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

// announceSignupGate announces the sign-up gate on a step whose next submit
// spends the sign-up proof: one whose on_success declares it, or one carrying a
// passkey registration that creates its user. Runtime enforcement does not
// depend on template markup or client-selected purpose. The step is looked up
// in def, the definition of the flow active in the result's state. issued is
// set when this request issued the result's pending challenge.
func (r *Runtime) announceSignupGate(ctx context.Context, def *domain.FlowDefinition, result *StepResult, issued bool) error {
	if result.Step == nil || result.State == nil {
		return nil
	}
	step, ok := def.FindStep(result.Step.Name)
	if ok && step.OnSuccessSpec().SpendsSignupProof {
		result.Step.SignupRequired = true
		return nil
	}
	creates, err := r.registrationCreatesUser(ctx, result, issued)
	if err != nil {
		return err
	}
	result.Step.SignupRequired = creates
	return nil
}

// registrationCreatesUser reports whether the step carries a passkey
// registration that creates its user, which its attestation spends the
// sign-up proof for. The pending challenge records that at issue; one issued
// by an earlier request is confirmed with the attempt, which decides at
// verification and no longer holds a superseded ceremony.
func (r *Runtime) registrationCreatesUser(ctx context.Context, result *StepResult, issued bool) (bool, error) {
	challenge := result.Step.Challenge
	if challenge == nil || challenge.Method != ChallengeMethodPasskeyRegister {
		return false, nil
	}
	if pending := result.State.PendingChallenge; pending != nil && pending.ID == challenge.ChallengeID {
		if !pending.Provisional {
			return false, nil
		}
		if issued {
			return true, nil
		}
	}
	return r.authAttempts.ProvisionalRegistration(ctx, result.State.ProjectID, result.State.AuthAttemptID, challenge.ChallengeID)
}
