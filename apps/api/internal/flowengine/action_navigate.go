package flowengine

import (
	"github.com/zitadel/nextgen/internal/domain"
)

// navigateHandler handles kind=navigate: it follows the action's transition
// without taking the step's inputs.
type navigateHandler struct{}

func (navigateHandler) process(r *Runtime, pc *processCtx) (StepResult, error) {
	// Navigating abandons any pending ceremony; without this the stale
	// challenge re-attaches on the next render.
	pc.state.ClearPendingChallenge()
	return r.routeOutcome(pc, domain.FlowResolvedFields{}, pc.in.Action, false)
}
