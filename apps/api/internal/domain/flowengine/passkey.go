package flowengine

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
)

// passkeyHandler handles kind=passkey, a two-phase WebAuthn sign-in. The issue
// leg runs the identifier dispatch so IssuePasskeyChallenge can populate
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
		return r.verifyPasskeyChallenge(pc, resolved, resolved)
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
	return r.issuePasskeyChallenge(pc, resolved)
}

func (passkeyHandler) acceptsSignupProof(*domain.FlowState, FlowSubmitInput) bool { return false }

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
		return r.verifyPasskeyChallenge(pc, resolved, passkeyResolved)
	}
	if pc.state.PendingChallenge != nil {
		return r.renderPendingChallenge(pc, resolved)
	}
	return r.issuePasskeyRegistrationChallenge(pc, resolved, passkeyResolved)
}

// acceptsSignupProof lets any submission to the step carry the proof while a
// registration is pending: it creates its user when the attempt has none yet.
// Only the attestation spends the proof, but the step announces the gate for
// as long as the ceremony is pending, so a client solves it for whatever it
// submits next: the password path it falls back to after a cancelled prompt
// must not be refused for bringing it.
func (passkeyRegisterHandler) acceptsSignupProof(state *domain.FlowState, in FlowSubmitInput) bool {
	pending := state.PendingChallenge != nil && state.PendingChallenge.Method == FlowChallengeMethodPasskeyRegister
	// Without a pending registration only its attestation may bring the
	// proof: an assertion of a sign-in the step also offers creates nobody.
	attests := in.ChallengeResponse != nil && in.ChallengeResponse.Method == FlowChallengeMethodPasskeyRegister
	return pending || attests
}

// renderPendingChallenge renders the step carrying the pending ceremony: one
// just issued, or one a submission of the same kind resumes without a proof.
func (r *FlowStateMachineRuntime) renderPendingChallenge(pc *processCtx, resolved domain.FlowResolvedFields) (FlowStepResult, error) {
	rendered, err := r.buildStep(pc.ctx, pc.state, pc.currentStep, resolved, nil, nil, nil)
	if err != nil {
		return FlowStepResult{}, err
	}
	attachPendingChallenge(rendered, pc.state.PendingChallenge)
	pc.state.IssuedAt = r.now()
	return FlowStepResult{State: pc.state, Step: rendered}, nil
}

// verifyPasskeyChallenge verifies the proof that arrived with the submission,
// by the pending ceremony's method, and routes the submitted action. The
// pending ceremony may be missing if the cookie was lost mid-ceremony; the
// DB rejects unknown challenge ids.
func (r *FlowStateMachineRuntime) verifyPasskeyChallenge(pc *processCtx, resolved, passkeyResolved domain.FlowResolvedFields) (FlowStepResult, error) {
	ctx, state, in := pc.ctx, pc.state, pc.in
	// The server-issued id is authoritative; never trust a client-supplied
	// one to rebind the proof to a different challenge.
	challengeID := in.ChallengeResponse.ChallengeID
	method := in.ChallengeResponse.Method
	if state.PendingChallenge != nil {
		challengeID = state.PendingChallenge.ID
		method = state.PendingChallenge.Method
	}

	switch method {
	case FlowChallengeMethodPasskeyRegister:
		// The verify transaction persists the credential, the user row
		// (when the ceremony is provisional), and the attempt factors
		// atomically — the attempt service decides provisional-or-not
		// from the stored challenge, and a provisional one spends the
		// sign-up proof first.
		err := r.authAttempts.SubmitPasskeyRegistration(ctx, domain.FlowSubmitPasskeyRegistrationInput{
			ProjectID:      state.ProjectID,
			AttemptID:      state.AuthAttemptID,
			UserID:         state.CollectedData.UserID,
			ChallengeID:    challengeID,
			Attestation:    in.ChallengeResponse.Proof,
			UserSchemaURL:  state.UserSchemaURL,
			UserAttributes: state.CollectedData.UserData,
			State:          state,
			GateProofs:     in.GateProofs,
		})
		if errors.Is(err, domain.ErrAuthAttemptProofRejected(nil)) {
			state.ClearPendingChallenge()
			return r.renderStepError(pc, resolved, domain.FlowStepFailed(FlowStepErrorPasskeyRegistrationInvalid, err))
		}
		if errors.Is(err, domain.ErrUserAlreadyExists()) {
			// A unique attribute of the provisional user is taken: route
			// like the identifier dispatch does. That path pins the
			// existing user on the attempt before routing — and the
			// downstream password step requires a persisted user factor —
			// so re-resolve the conflicting owner here to land in the
			// same state. Trying every collected uniquely-keyed field
			// finds the owner even when the race was lost on an
			// undesignated unique attribute (e.g. a fresh email but a
			// taken phone).
			clearUserBoundState(state)
			candidates := uniqueFieldValues(state.CollectedData.UserData, passkeyResolved)
			if visited, verr := r.resolveVisitedFields(pc); verr == nil {
				candidates = uniqueFieldValues(state.CollectedData.UserData, passkeyResolved, visited)
			}
			for _, candidate := range candidates {
				// Only a sign-up's create loses this race, so a free
				// candidate is the sign-up's own value, not a failed
				// sign-in: Register keeps it from writing one.
				userID, rerr := r.authAttempts.SubmitIdentifier(ctx, domain.FlowSubmitIdentifierInput{
					ProjectID:     state.ProjectID,
					AttemptID:     state.AuthAttemptID,
					AttributeName: candidate[0],
					Value:         candidate[1],
					UserSchemaURL: state.UserSchemaURL,
					Register:      true,
				})
				if rerr == nil {
					recordResolvedUser(state, userID)
					break
				}
				if !errors.Is(rerr, domain.ErrAuthAttemptProofRejected(nil)) {
					return FlowStepResult{}, fmt.Errorf("flow state machine: resolve conflicting user: %w", rerr)
				}
				// Rejected means this field's value is not the taken one
				// (or the owner vanished again); try the next candidate.
				// All-rejected routes anyway and the next step re-collects.
			}
			return r.routeOutcome(pc, resolved, domain.FlowImplicitOutcomeUserAlreadyExists, false)
		}
		if errors.Is(err, domain.ErrAuthAttemptStaleChallenge()) {
			// The ceremony window is tighter than the attempt TTL, and a
			// deploy can strand an in-flight ceremony too. Clear the
			// pending challenge so a retry mints a fresh one instead of
			// re-emitting the stale ceremony until the attempt dies.
			state.ClearPendingChallenge()
			return r.renderStepError(pc, resolved, domain.FlowStepFailed(FlowStepErrorPasskeyRegistrationInvalid, err))
		}
		if err != nil {
			return FlowStepResult{}, fmt.Errorf("flow state machine: submit passkey registration: %w", err)
		}
		recordResolvedUser(state, state.CollectedData.UserID)
		state.ClearPendingChallenge()
		// Registration wrote a credential — the user cannot back out.
		return r.routeOutcome(pc, resolved, in.Action, true)

	default: // FlowChallengeMethodPasskey
		userID, err := r.authAttempts.SubmitPasskey(ctx, domain.FlowSubmitPasskeyInput{
			ProjectID:   state.ProjectID,
			AttemptID:   state.AuthAttemptID,
			ChallengeID: challengeID,
			Assertion:   in.ChallengeResponse.Proof,
		})
		if errors.Is(err, domain.ErrAuthAttemptProofRejected(nil)) || errors.Is(err, domain.ErrAuthAttemptStaleChallenge()) {
			// Both a rejected assertion and a stale challenge (e.g. after
			// a deploy) render on the step with the pending ceremony
			// cleared, so a retry mints a fresh challenge.
			state.ClearPendingChallenge()
			return r.renderStepError(pc, resolved, domain.FlowStepFailed(FlowStepErrorPasskeyInvalid, err))
		}
		if err != nil {
			return FlowStepResult{}, fmt.Errorf("flow state machine: submit passkey: %w", err)
		}
		recordResolvedUser(state, userID)
		state.ClearPendingChallenge()
		return r.routeOutcome(pc, resolved, in.Action, false)
	}
}

// issuePasskeyChallenge mints an assertion challenge and renders the step
// carrying it.
func (r *FlowStateMachineRuntime) issuePasskeyChallenge(pc *processCtx, resolved domain.FlowResolvedFields) (FlowStepResult, error) {
	state, in := pc.state, pc.in
	if in.PasskeyRP == nil {
		return FlowStepResult{}, fmt.Errorf("%w: passkey relying-party params missing", domain.ErrFlowIntegrity())
	}
	out, err := r.authAttempts.IssuePasskeyChallenge(pc.ctx, domain.FlowIssuePasskeyChallengeInput{
		ProjectID:        state.ProjectID,
		AttemptID:        state.AuthAttemptID,
		RPID:             in.PasskeyRP.RPID,
		RPOrigins:        in.PasskeyRP.Origins,
		UserVerification: flowPasskeyDefaultUserVerification,
	})
	if err != nil {
		return FlowStepResult{}, fmt.Errorf("flow state machine: issue passkey: %w", err)
	}
	state.PendingChallenge = &domain.FlowPendingChallenge{
		ID:       out.ChallengeID,
		Method:   FlowChallengeMethodPasskey,
		Options:  out.Options,
		IssuedAt: r.now(),
	}
	return r.renderPendingChallenge(pc, resolved)
}

// issuePasskeyRegistrationChallenge mints a creation challenge and renders
// the step carrying it.
func (r *FlowStateMachineRuntime) issuePasskeyRegistrationChallenge(pc *processCtx, resolved, passkeyResolved domain.FlowResolvedFields) (FlowStepResult, error) {
	state, in := pc.state, pc.in
	if in.PasskeyRP == nil {
		return FlowStepResult{}, fmt.Errorf("%w: passkey relying-party params missing", domain.ErrFlowIntegrity())
	}
	username, displayName := passkeyRegistrationDisplay(passkeyResolved, state.CollectedData.UserData)
	out, err := r.authAttempts.IssuePasskeyRegistrationChallenge(pc.ctx, domain.FlowIssuePasskeyRegistrationChallengeInput{
		ProjectID:   state.ProjectID,
		AttemptID:   state.AuthAttemptID,
		UserID:      state.CollectedData.UserID,
		Username:    username,
		DisplayName: displayName,
		RPID:        in.PasskeyRP.RPID,
		RPOrigins:   in.PasskeyRP.Origins,
	})
	if err != nil {
		return FlowStepResult{}, fmt.Errorf("flow state machine: issue passkey registration: %w", err)
	}
	// Keep the (possibly minted) user handle so a re-issued challenge
	// stays stable and the verify leg knows which user it targets.
	state.CollectedData.UserID = out.UserID
	state.PendingChallenge = &domain.FlowPendingChallenge{
		ID:       out.ChallengeID,
		Method:   FlowChallengeMethodPasskeyRegister,
		Options:  out.Options,
		IssuedAt: r.now(),
	}
	return r.renderPendingChallenge(pc, resolved)
}

// needsPasskeyRegistrationVisitedFields reports whether a passkey_register
// submission runs the registration ceremony: every leg but the verify leg of
// an assertion.
func needsPasskeyRegistrationVisitedFields(state *domain.FlowState, in FlowSubmitInput) bool {
	if in.ChallengeResponse == nil {
		return true
	}
	if state != nil && state.PendingChallenge != nil {
		return state.PendingChallenge.Method == FlowChallengeMethodPasskeyRegister
	}
	return in.ChallengeResponse.Method == FlowChallengeMethodPasskeyRegister
}

func passkeyRegistrationDisplay(resolved domain.FlowResolvedFields, collected map[string]any) (string, string) {
	_, _, value, ok := FindCollectedFieldByChallenge(resolved.Fields, collected, domain.FlowFieldChallengeIdentifier)
	if !ok {
		return "", ""
	}
	svalue, _ := value.(string)
	label := strings.TrimSpace(svalue)
	if label == "" {
		return "", ""
	}
	return label, label
}

// attachPendingChallenge surfaces a pending ceremony on a rendered step so the
// client can run it (and re-run it on a plain GET re-render).
func attachPendingChallenge(step *FlowStep, pc *domain.FlowPendingChallenge) {
	if step == nil || pc == nil {
		return
	}
	step.Challenge = &FlowStepChallenge{
		Method:      pc.Method,
		ChallengeID: pc.ID,
		Options:     pc.Options,
	}
}

// offersPasskey reports whether the step's passkey sign-in actions are shown.
// They are, except to a user bound by an external sign-in's collision who has
// no passkey: the ceremony could only fail for them. That reveals nothing the
// action would not, since a ceremony for a bound user lists that user's
// passkeys as allowCredentials. Anyone else is never asked, so the step does
// not depend on an account the visitor has not reached.
func (r *FlowStateMachineRuntime) offersPasskey(ctx context.Context, state *domain.FlowState, step *domain.FlowDefinitionStep) (bool, error) {
	if state.CollectedData.SSOConflictConnectionID == "" || state.CollectedData.UserID == "" {
		return true, nil
	}
	if !stepHasActionKind(step, domain.FlowActionKindPasskey) {
		return true, nil
	}
	has, err := r.ssoIdentities.UserHasPasskey(ctx, state.ProjectID, state.CollectedData.UserID)
	if err != nil {
		return false, fmt.Errorf("flow state machine: read passkeys of the bound user: %w", err)
	}
	return has, nil
}
