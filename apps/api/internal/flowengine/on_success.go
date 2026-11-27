package flowengine

import (
	"github.com/zitadel/nextgen/internal/domain"
)

// onSuccessHandler performs one [domain.FlowOnSuccess] mutation; what the
// mutation needs is its [domain.FlowOnSuccessSpec].
type onSuccessHandler interface {
	// run performs the mutation on a submit of the step whose inputs
	// validated, and routes the result.
	run(r *Runtime, pc *processCtx, resolved domain.FlowResolvedFields) (StepResult, error)
}

// onSuccessHandlers holds one handler per [domain.FlowOnSuccess] value.
var onSuccessHandlers = map[domain.FlowOnSuccess]onSuccessHandler{
	domain.FlowOnSuccessCreateUser:        createUserHandler{},
	domain.FlowOnSuccessCreateUserWithSso: createUserWithSSOHandler{},
}

// createUserHandler handles create_user: the service creates the user from
// the values collected across the flow.
type createUserHandler struct{}

func (createUserHandler) run(r *Runtime, pc *processCtx, resolved domain.FlowResolvedFields) (StepResult, error) {
	// on_success reads across every visited step, not just the current one.
	visitedResolved, err := r.resolveVisitedFields(pc)
	if err != nil {
		return StepResult{}, err
	}
	result, err := r.userCreater.Handle(pc.ctx, OnSuccessInput{
		GateProofs:    pc.in.GateProofs,
		ProjectID:     pc.state.ProjectID,
		UserSchemaURL: pc.state.UserSchemaURL,
		Resolved:      visitedResolved,
		State:         pc.state,
	})
	if err != nil {
		return StepResult{}, err
	}
	if result.StepError != nil {
		return r.renderStepError(pc, resolved, result.StepError)
	}
	if result.UserID != "" {
		// The handler already recorded the user's factors on the attempt
		// inside its own transaction; only the flow state needs the id.
		recordResolvedUser(pc.state, result.UserID)
	}
	return r.routeOutcome(pc, resolved, pc.in.Action, result.Irreversible)
}
