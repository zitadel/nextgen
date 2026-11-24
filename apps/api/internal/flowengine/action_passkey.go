package flowengine

// passkeyHandler handles kind=passkey, a two-phase WebAuthn sign-in. The issue
// leg runs the identifier dispatch so the issued challenge can populate
// allowCredentials, and only that, because the leg submits nothing else (see
// [identifierFieldsOnly]); discoverable login is allowed when no user is yet
// identified. The verify leg validates the assertion.
type passkeyHandler struct{}

func (passkeyHandler) process(r *FlowStateMachineRuntime, pc *processCtx) (FlowStepResult, error) {
	resolved, halt, err := r.takeInputs(pc, stepInputs{identifierOnly: true, challengeMethod: FlowChallengeMethodPasskey})
	if err != nil {
		return FlowStepResult{}, err
	}
	if halt != nil {
		return *halt, nil
	}
	if pc.in.ChallengeResponse != nil {
		return r.verifyChallenge(pc, resolved, resolved)
	}
	dispatch, err := r.dispatchChallenges(pc, resolved)
	if err != nil {
		return FlowStepResult{}, err
	}
	if dispatch.StepError != nil {
		return r.renderStepError(pc, resolved, dispatch.StepError)
	}
	if dispatch.Outcome != "" {
		// user_not_found and the like — skip the ceremony and route directly.
		return r.routeOutcome(pc, resolved, dispatch.Outcome, false)
	}
	if pc.state.PendingChallenge != nil {
		return r.renderPendingChallenge(pc, resolved)
	}
	return r.issueChallenge(pc, FlowChallengeMethodPasskey, resolved, resolved)
}
