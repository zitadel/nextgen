package flowengine

import (
	"github.com/zitadel/nextgen/internal/domain"
)

// advance records the transition. prevPurpose is captured before the
// outcome flip so `back` can restore both step and purpose.
func (r *FlowStateMachineRuntime) advance(state *FlowState, prev *domain.FlowDefinitionStep, prevPurpose domain.FlowDefinitionPurpose, nextStepName string) {
	state.History = append(state.History, prev.Name)
	state.BackStack = append(state.BackStack, FlowBackEntry{StepName: prev.Name, Purpose: prevPurpose})
	state.CurrentStep = nextStepName
	state.IssuedAt = r.now()
}
