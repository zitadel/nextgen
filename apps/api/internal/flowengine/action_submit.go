package flowengine

import (
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
)

// submitHandler handles kind=submit: collect the step's fields, dispatch
// challenges, run on_success (if declared), and route the resulting outcome.
type submitHandler struct{}

func (submitHandler) process(r *FlowStateMachineRuntime, pc *processCtx) (FlowStepResult, error) {
	resolved, halt, err := r.takeInputs(pc, stepInputs{collectsStepFields: true})
	if err != nil {
		return FlowStepResult{}, err
	}
	if halt != nil {
		return *halt, nil
	}
	// The step's values describe the provider's identity, not a sign-in, so
	// its identifier is never submitted as one.
	if !pc.currentStep.OnSuccessSpec().ProviderIdentity {
		dispatch, err := r.dispatchChallenges(pc, resolved)
		if err != nil {
			return FlowStepResult{}, err
		}
		if dispatch.StepError != nil {
			return r.renderStepError(pc, resolved, dispatch.StepError)
		}
		if dispatch.Outcome != "" {
			return r.routeOutcome(pc, resolved, dispatch.Outcome, false)
		}
	}
	if pc.currentStep.OnSuccess == nil {
		return r.routeOutcome(pc, resolved, pc.in.Action, false)
	}
	handler, ok := onSuccessHandlers[*pc.currentStep.OnSuccess]
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: on_success %s not wired", domain.ErrFlowIntegrity(), *pc.currentStep.OnSuccess)
	}
	return handler.run(r, pc, resolved)
}
