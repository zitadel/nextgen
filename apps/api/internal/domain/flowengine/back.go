package flowengine

import (
	"fmt"
	"slices"

	"github.com/zitadel/nextgen/internal/domain"
)

// advance records the transition. prevPurpose is captured before the
// outcome flip so `back` can restore both step and purpose.
func (r *FlowStateMachineRuntime) advance(state *domain.FlowState, prev *domain.FlowDefinitionStep, prevPurpose domain.FlowDefinitionPurpose, nextStepName string) {
	state.History = append(state.History, prev.Name)
	state.BackStack = append(state.BackStack, domain.FlowBackEntry{StepName: prev.Name, Purpose: prevPurpose})
	state.CurrentStep = nextStepName
	state.IssuedAt = r.now()
}

// processBack pops the previous BackStack entry and re-renders that step,
// restoring the snapshotted purpose. PendingChallenge is dropped; History is
// left intact.
//
// CollectedData.UserData survives, so the previous form prefills. The rest of
// CollectedData depends on where back lands: a step that collects the
// identifier is the user going back to change who they are signing in as, so
// the resolved user and the password collected for them go too, and the auth
// attempt rotates with them (see [dropResolvedUser]). Landing anywhere else
// leaves all of it in place.
func (r *FlowStateMachineRuntime) processBack(pc *processCtx) (FlowStepResult, error) {
	prev, ok := pc.state.PeekBackStack()
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: back submitted with empty back stack on step %q", domain.ErrFlowInvalidAction(), pc.state.CurrentStep)
	}
	prevStep, ok := pc.def.FindStep(prev.StepName)
	if !ok {
		return FlowStepResult{}, fmt.Errorf("%w: back-stack step %q missing from definition", domain.ErrFlowIntegrity(), prev.StepName)
	}
	pc.state.PopBackStack()
	pc.state.CurrentStep = prev.StepName
	pc.state.CurrentPurpose = prev.Purpose
	pc.state.ClearPendingChallenge()

	// One resolution serves both the identifier check and the render below:
	// it is the same step either way, and resolving twice would double the
	// schema load and the chance of a transient failure on one back click.
	resolved, err := r.resolveStepFields(pc.ctx, pc.state, prevStep)
	if err != nil {
		return FlowStepResult{}, err
	}

	// The identifier is re-offered, so the user may submit a different one —
	// and even an unchanged one re-runs the user challenge. Both need an
	// attempt without a user factor on it; keeping the resolved user would
	// also scope the next passkey ceremony's allowCredentials to whoever the
	// abandoned leg resolved.
	collectsIdentifier := slices.ContainsFunc(resolved.Fields, func(f domain.FlowField) bool {
		return f.Challenge == domain.FlowFieldChallengeIdentifier
	})
	if collectsIdentifier {
		if err := r.dropResolvedUser(pc, "back to identification"); err != nil {
			return FlowStepResult{}, err
		}
		// The password belongs to the identity being dropped, and
		// [mergeCollected] banks it before the proof is ever checked, so a
		// rejected password would otherwise reach create_user for whoever the
		// flow resolves next. A password field always renders empty, so
		// clearing it costs the user nothing.
		pc.state.CollectedData.AuthMethods.Password = ""
	}

	// Prefill and build after the drop, so the step reflects the state the
	// user is actually returning to.
	if err := r.prefillStep(pc.ctx, pc.state, prevStep, &resolved); err != nil {
		return FlowStepResult{}, err
	}
	step, err := r.buildStep(pc.ctx, pc.state, prevStep, resolved, nil, nil, nil)
	if err != nil {
		return FlowStepResult{}, err
	}
	pc.state.IssuedAt = r.now()
	return FlowStepResult{State: pc.state, Step: step}, nil
}
