package flowengine

import (
	"github.com/zitadel/nextgen/internal/domain"
)

// actionKindHandler owns what the engine does for one [domain.FlowActionKind].
type actionKindHandler interface {
	// process handles a submission of an action of this kind on the current step.
	process(r *FlowStateMachineRuntime, pc *processCtx) (FlowStepResult, error)
	// acceptsSignupProof reports whether a step declaring an action of this
	// kind lets the submission carry the sign-up proof.
	acceptsSignupProof(state *domain.FlowState, in FlowSubmitInput) bool
}

// actionKindHandlers holds one handler per kind a step can declare or the
// engine injects. Unset has none: no action of the step has that name.
var actionKindHandlers = map[domain.FlowActionKind]actionKindHandler{
	domain.FlowActionKindSubmit:          submitHandler{},
	domain.FlowActionKindPasskey:         passkeyHandler{},
	domain.FlowActionKindPasskeyRegister: passkeyRegisterHandler{},
	domain.FlowActionKindNavigate:        navigateHandler{},
	domain.FlowActionKindBack:            backHandler{},
}

// stepInputs is how a submission of one kind takes the step's inputs.
type stepInputs struct {
	// identifierOnly narrows the submitted values to the step's identifier
	// fields (see [identifierFieldsOnly]).
	identifierOnly bool
	// collectsStepFields requires the step's required fields: the submission
	// commits them to the user.
	collectsStepFields bool
	// challengeMethod is the ceremony the kind runs. A pending ceremony of
	// another method is dropped when the submission brings no proof.
	challengeMethod string
}

// takeInputs resolves the step's inputs, then validates and merges what the
// client sent. A non-nil halt is the step rendered with the validation errors.
func (r *FlowStateMachineRuntime) takeInputs(pc *processCtx, inputs stepInputs) (domain.FlowResolvedFields, *FlowStepResult, error) {
	resolved, err := r.resolveInputs(pc)
	if err != nil {
		return domain.FlowResolvedFields{}, nil, err
	}
	if inputs.identifierOnly {
		pc.in.Fields = identifierFieldsOnly(resolved, pc.in.Fields)
	}
	halt, err := r.validateAndMerge(pc, resolved, inputs.collectsStepFields)
	if err != nil || halt != nil {
		return resolved, halt, err
	}
	// If a ceremony is pending and the user picked a different action,
	// drop it so we don't re-emit the abandoned prompt.
	pending := pc.state.PendingChallenge
	if pending != nil && pc.in.ChallengeResponse == nil &&
		(inputs.challengeMethod == "" || pending.Method != inputs.challengeMethod) {
		pc.state.ClearPendingChallenge()
	}
	return resolved, nil, nil
}

// acceptsSignupProof reports whether a submission to step may carry the
// sign-up proof: one to a step that creates its user on success, or one a
// kind the step declares accepts it with.
func acceptsSignupProof(step *domain.FlowDefinitionStep, state *domain.FlowState, in FlowSubmitInput) bool {
	if step.OnSuccess != nil && *step.OnSuccess == domain.FlowOnSuccessCreateUser {
		return true
	}
	for _, a := range step.Actions {
		if handler, ok := actionKindHandlers[a.Kind]; ok && handler.acceptsSignupProof(state, in) {
			return true
		}
	}
	return false
}

// stepHasActionKind reports whether the step declares any action of the
// given kind.
func stepHasActionKind(step *domain.FlowDefinitionStep, kind domain.FlowActionKind) bool {
	for _, a := range step.Actions {
		if a.Kind == kind {
			return true
		}
	}
	return false
}

// stepActionKind returns the kind of the step's action with the given name.
// Returns the zero value (unset) when name does not match any action on the
// step.
func stepActionKind(step *domain.FlowDefinitionStep, actionName string) domain.FlowActionKind {
	for _, a := range step.Actions {
		if a.Name == actionName {
			return a.Kind
		}
	}

	// back is not always defined in the step.Actions, it might be auto-injected.
	if actionName == domain.FlowBackActionName {
		return domain.FlowActionKindBack
	}

	return domain.FlowActionKindUnset
}
