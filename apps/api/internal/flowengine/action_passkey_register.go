package flowengine

// passkeyRegisterHandler handles kind=passkey_register, a two-phase WebAuthn
// enrollment. The issue leg uses the collected user id (or lets the
// registration service mint a provisional one), then issues a creation
// challenge; the verify leg persists the credential.
type passkeyRegisterHandler struct{}

func (passkeyRegisterHandler) process(r *FlowStateMachineRuntime, pc *processCtx) (FlowStepResult, error) {
	// The issue leg commits the step's fields to the user it registers; the
	// verify leg sends none.
	resolved, halt, err := r.takeInputs(pc, stepInputs{
		collectsStepFields: pc.in.ChallengeResponse == nil,
		challengeMethod:    FlowChallengeMethodPasskeyRegister,
	})
	if err != nil {
		return FlowStepResult{}, err
	}
	if halt != nil {
		return *halt, nil
	}
	// The visited-fields union lets the display name pull attributes from
	// earlier steps.
	passkeyResolved := resolved
	if needsPasskeyRegistrationVisitedFields(pc.state, pc.in) {
		visitedResolved, err := r.resolveVisitedFields(pc)
		if err != nil {
			return FlowStepResult{}, err
		}
		passkeyResolved = visitedResolved
	}
	if pc.in.ChallengeResponse != nil {
		return r.verifyChallenge(pc, resolved, passkeyResolved)
	}
	if pc.state.PendingChallenge != nil {
		return r.renderPendingChallenge(pc, resolved)
	}
	return r.issueChallenge(pc, FlowChallengeMethodPasskeyRegister, resolved, passkeyResolved)
}

// acceptsSignupProof lets any submission to the step carry the proof while a
// registration is pending: it creates its user when the attempt has none yet.
// Only the attestation spends the proof, but the step announces the gate for
// as long as the ceremony is pending, so a client solves it for whatever it
// submits next: the password path it falls back to after a cancelled prompt
// must not be refused for bringing it.
func (passkeyRegisterHandler) acceptsSignupProof(state *FlowState, in FlowSubmitInput) bool {
	pending := state.PendingChallenge != nil && state.PendingChallenge.Method == FlowChallengeMethodPasskeyRegister
	// Without a pending registration only its attestation may bring the
	// proof: an assertion of a sign-in the step also offers creates nobody.
	attests := in.ChallengeResponse != nil && in.ChallengeResponse.Method == FlowChallengeMethodPasskeyRegister
	return pending || attests
}

// needsPasskeyRegistrationVisitedFields reports whether a passkey_register
// submission runs the registration ceremony: every leg but the verify leg of
// an assertion.
func needsPasskeyRegistrationVisitedFields(state *FlowState, in FlowSubmitInput) bool {
	if in.ChallengeResponse == nil {
		return true
	}
	if state != nil && state.PendingChallenge != nil {
		return state.PendingChallenge.Method == FlowChallengeMethodPasskeyRegister
	}
	return in.ChallengeResponse.Method == FlowChallengeMethodPasskeyRegister
}
