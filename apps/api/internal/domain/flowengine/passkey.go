package flowengine

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
)

// processPasskeyLogin handles kind=passkey. The issue leg runs the
// identifier dispatch so IssuePasskeyChallenge can populate
// allowCredentials — and only that, because the leg reaches here holding
// nothing else (see [identifierFieldsOnly]); the verify leg validates the
// assertion. Ceremony abandonment falls through to the standard pipeline.
func (r *FlowStateMachineRuntime) processPasskeyLogin(pc *processCtx, resolved domain.FlowResolvedFields) (FlowStepResult, error) {
	if pc.in.ChallengeResponse == nil {
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
	}

	pk, err := r.processPasskey(pc, resolved, resolved, domain.FlowActionKindPasskey)
	if err != nil {
		return FlowStepResult{}, err
	}
	if pk.halt != nil {
		return *pk.halt, nil
	}
	if !pk.handled {
		// Ceremony was abandoned (pending challenge didn't match the
		// submitted action): treat the submit as a plain kind=submit so
		// the user still gets a response.
		return r.processSubmit(pc, resolved)
	}
	if pk.outcome != "" {
		return r.routeOutcome(pc, resolved, pk.outcome, false)
	}

	return r.routeOutcome(pc, resolved, pc.in.Action, pk.irreversible)
}

// processPasskeyRegister handles kind=passkey_register. Uses the
// visited-fields union so the display name can pull attributes from
// earlier steps. Ceremony abandonment falls back to the standard
// pipeline, same as login.
func (r *FlowStateMachineRuntime) processPasskeyRegister(pc *processCtx, resolved domain.FlowResolvedFields) (FlowStepResult, error) {
	passkeyResolved := resolved
	if needsPasskeyRegistrationVisitedFields(pc.state, pc.in, domain.FlowActionKindPasskeyRegister) {
		visitedResolved, err := r.resolveVisitedFields(pc)
		if err != nil {
			return FlowStepResult{}, err
		}
		passkeyResolved = visitedResolved
	}

	pk, err := r.processPasskey(pc, resolved, passkeyResolved, domain.FlowActionKindPasskeyRegister)
	if err != nil {
		return FlowStepResult{}, err
	}
	if pk.halt != nil {
		return *pk.halt, nil
	}
	if !pk.handled {
		// Ceremony was abandoned (pending challenge didn't match the
		// submitted action): treat the submit as a plain kind=submit so
		// the user still gets a response.
		return r.processSubmit(pc, resolved)
	}
	if pk.outcome != "" {
		return r.routeOutcome(pc, resolved, pk.outcome, false)
	}

	return r.routeOutcome(pc, resolved, pc.in.Action, pk.irreversible)
}

// passkeyPhaseResult reports how the two-phase passkey handler interacted
// with a submission. handled is true when a passkey leg ran (so the
// field-shaped dispatch must be skipped); halt, when non-nil, is the result
// to return immediately (challenge issued and awaiting proof, or a
// verification error rendered on the step); outcome, when set, diverts
// routing (e.g. user_already_exists from a provisional registration).
type passkeyPhaseResult struct {
	handled      bool
	irreversible bool
	outcome      string
	halt         *FlowStepResult
}

// processPasskey runs all two-phase WebAuthn ceremonies (authentication and
// registration) for the current step:
//   - resume/abandon leg: a challenge is pending and no proof has arrived. If
//     the submission targets the same ceremony, re-emit
//     the pending challenge. Otherwise the user picked a different action;
//     drop the pending challenge and let normal routing run.
//   - verify leg: a ChallengeResponse arrived → dispatch to the right service
//     based on PendingChallenge.Method, clear the pending challenge, and let
//     Process route via the submitted action.
//   - issue leg (auth): step offers a `passkey` action and it was selected →
//     mint an assertion challenge; discoverable login allowed when no user is
//     yet identified.
//   - issue leg (register): step offers a `passkey_register` action and it
//     was selected → use the collected user id (or let the registration
//     service mint a provisional one), then issue a creation challenge.
func (r *FlowStateMachineRuntime) processPasskey(pc *processCtx, resolved domain.FlowResolvedFields, passkeyResolved domain.FlowResolvedFields, actionKind domain.FlowActionKind) (passkeyPhaseResult, error) {
	ctx, state, step, in := pc.ctx, pc.state, pc.currentStep, pc.in
	switch {
	// A ceremony is in flight but no proof arrived: resume or abandon.
	case state.PendingChallenge != nil && in.ChallengeResponse == nil:
		if !pendingMatchesKind(state.PendingChallenge.Method, actionKind) {
			state.ClearPendingChallenge()
			return passkeyPhaseResult{}, nil
		}
		rendered, err := r.buildStep(ctx, pc.state, pc.currentStep, resolved, nil, nil, nil)
		if err != nil {
			return passkeyPhaseResult{}, err
		}
		attachPendingChallenge(rendered, state.PendingChallenge)
		state.IssuedAt = r.now()
		return passkeyPhaseResult{handled: true, halt: &FlowStepResult{State: state, Step: rendered}}, nil

	// A proof arrived: verify it (pending may be missing if the cookie
	// was lost mid-ceremony; the DB rejects unknown challenge ids).
	case in.ChallengeResponse != nil:
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
				rendered, err := r.buildStep(ctx, pc.state, pc.currentStep, resolved, domain.FlowStepFailed(FlowStepErrorPasskeyRegistrationInvalid, err), nil, nil)
				if err != nil {
					return passkeyPhaseResult{}, err
				}
				state.IssuedAt = r.now()
				return passkeyPhaseResult{handled: true, halt: &FlowStepResult{State: state, Step: rendered}}, nil
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
						return passkeyPhaseResult{}, fmt.Errorf("flow state machine: resolve conflicting user: %w", rerr)
					}
					// Rejected means this field's value is not the taken one
					// (or the owner vanished again); try the next candidate.
					// All-rejected routes anyway and the next step re-collects.
				}
				return passkeyPhaseResult{handled: true, outcome: domain.FlowImplicitOutcomeUserAlreadyExists}, nil
			}
			if errors.Is(err, domain.ErrAuthAttemptStaleChallenge()) {
				// The ceremony window is tighter than the attempt TTL, and a
				// deploy can strand an in-flight ceremony too. Clear the
				// pending challenge so a retry mints a fresh one instead of
				// re-emitting the stale ceremony until the attempt dies.
				state.ClearPendingChallenge()
				rendered, err := r.buildStep(ctx, pc.state, pc.currentStep, resolved, domain.FlowStepFailed(FlowStepErrorPasskeyRegistrationInvalid, err), nil, nil)
				if err != nil {
					return passkeyPhaseResult{}, err
				}
				state.IssuedAt = r.now()
				return passkeyPhaseResult{handled: true, halt: &FlowStepResult{State: state, Step: rendered}}, nil
			}
			if err != nil {
				return passkeyPhaseResult{}, fmt.Errorf("flow state machine: submit passkey registration: %w", err)
			}
			recordResolvedUser(state, state.CollectedData.UserID)
			state.ClearPendingChallenge()
			// Registration wrote a credential — the user cannot back out.
			return passkeyPhaseResult{handled: true, irreversible: true}, nil

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
				rendered, err := r.buildStep(ctx, pc.state, pc.currentStep, resolved, domain.FlowStepFailed(FlowStepErrorPasskeyInvalid, err), nil, nil)
				if err != nil {
					return passkeyPhaseResult{}, err
				}
				state.IssuedAt = r.now()
				return passkeyPhaseResult{handled: true, halt: &FlowStepResult{State: state, Step: rendered}}, nil
			}
			if err != nil {
				return passkeyPhaseResult{}, fmt.Errorf("flow state machine: submit passkey: %w", err)
			}
			recordResolvedUser(state, userID)
			state.ClearPendingChallenge()
			return passkeyPhaseResult{handled: true}, nil
		}

	case actionKind == domain.FlowActionKindPasskey:
		if !stepHasActionKind(step, domain.FlowActionKindPasskey) {
			return passkeyPhaseResult{}, nil
		}
		if in.PasskeyRP == nil {
			return passkeyPhaseResult{}, fmt.Errorf("%w: passkey relying-party params missing", domain.ErrFlowIntegrity())
		}
		out, err := r.authAttempts.IssuePasskeyChallenge(ctx, domain.FlowIssuePasskeyChallengeInput{
			ProjectID:        state.ProjectID,
			AttemptID:        state.AuthAttemptID,
			RPID:             in.PasskeyRP.RPID,
			RPOrigins:        in.PasskeyRP.Origins,
			UserVerification: flowPasskeyDefaultUserVerification,
		})
		if err != nil {
			return passkeyPhaseResult{}, fmt.Errorf("flow state machine: issue passkey: %w", err)
		}
		state.PendingChallenge = &domain.FlowPendingChallenge{
			ID:       out.ChallengeID,
			Method:   FlowChallengeMethodPasskey,
			Options:  out.Options,
			IssuedAt: r.now(),
		}
		rendered, err := r.buildStep(ctx, pc.state, pc.currentStep, resolved, nil, nil, nil)
		if err != nil {
			return passkeyPhaseResult{}, err
		}
		attachPendingChallenge(rendered, state.PendingChallenge)
		state.IssuedAt = r.now()
		return passkeyPhaseResult{handled: true, halt: &FlowStepResult{State: state, Step: rendered}}, nil

	case actionKind == domain.FlowActionKindPasskeyRegister:
		if !stepHasActionKind(step, domain.FlowActionKindPasskeyRegister) {
			return passkeyPhaseResult{}, nil
		}
		if in.PasskeyRP == nil {
			return passkeyPhaseResult{}, fmt.Errorf("%w: passkey relying-party params missing", domain.ErrFlowIntegrity())
		}
		username, displayName := passkeyRegistrationDisplay(passkeyResolved, state.CollectedData.UserData)
		out, err := r.authAttempts.IssuePasskeyRegistrationChallenge(ctx, domain.FlowIssuePasskeyRegistrationChallengeInput{
			ProjectID:   state.ProjectID,
			AttemptID:   state.AuthAttemptID,
			UserID:      state.CollectedData.UserID,
			Username:    username,
			DisplayName: displayName,
			RPID:        in.PasskeyRP.RPID,
			RPOrigins:   in.PasskeyRP.Origins,
		})
		if err != nil {
			return passkeyPhaseResult{}, fmt.Errorf("flow state machine: issue passkey registration: %w", err)
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
		rendered, err := r.buildStep(ctx, pc.state, pc.currentStep, resolved, nil, nil, nil)
		if err != nil {
			return passkeyPhaseResult{}, err
		}
		attachPendingChallenge(rendered, state.PendingChallenge)
		state.IssuedAt = r.now()
		return passkeyPhaseResult{handled: true, halt: &FlowStepResult{State: state, Step: rendered}}, nil
	}
	return passkeyPhaseResult{}, nil
}

func needsPasskeyRegistrationVisitedFields(state *domain.FlowState, in FlowSubmitInput, actionKind domain.FlowActionKind) bool {
	if actionKind == domain.FlowActionKindPasskeyRegister && in.ChallengeResponse == nil {
		return true
	}
	if in.ChallengeResponse == nil {
		return false
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

// pendingMatchesKind reports whether a no-proof POST should resume the
// pending ceremony (vs. abandon it): the submitted action's kind must match
// the pending ceremony's method.
func pendingMatchesKind(pendingMethod string, submittedKind domain.FlowActionKind) bool {
	switch pendingMethod {
	case FlowChallengeMethodPasskey:
		return submittedKind == domain.FlowActionKindPasskey
	case FlowChallengeMethodPasskeyRegister:
		return submittedKind == domain.FlowActionKindPasskeyRegister
	}
	return false
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
