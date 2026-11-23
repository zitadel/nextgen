package flowengine

import (
	"context"
	"fmt"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
)

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
func (passkeyRegisterHandler) acceptsSignupProof(state *domain.FlowState, in FlowSubmitInput) bool {
	pending := state.PendingChallenge != nil && state.PendingChallenge.Method == FlowChallengeMethodPasskeyRegister
	// Without a pending registration only its attestation may bring the
	// proof: an assertion of a sign-in the step also offers creates nobody.
	attests := in.ChallengeResponse != nil && in.ChallengeResponse.Method == FlowChallengeMethodPasskeyRegister
	return pending || attests
}

// passkeyChallengeParams issues an assertion with the request's relying party.
func passkeyChallengeParams(pc *processCtx, _ domain.FlowResolvedFields) (domain.FlowChallengeParams, error) {
	rp := pc.in.PasskeyRP
	if rp == nil {
		return nil, fmt.Errorf("%w: passkey relying-party params missing", domain.ErrFlowIntegrity())
	}
	return domain.FlowPasskeyChallengeParams{
		RPID:             rp.RPID,
		RPOrigins:        rp.Origins,
		UserVerification: flowPasskeyDefaultUserVerification,
	}, nil
}

// passkeyRegistrationChallengeParams issues a creation challenge for the
// flow's user, labelled with the collected identifier.
func passkeyRegistrationChallengeParams(pc *processCtx, fields domain.FlowResolvedFields) (domain.FlowChallengeParams, error) {
	rp := pc.in.PasskeyRP
	if rp == nil {
		return nil, fmt.Errorf("%w: passkey relying-party params missing", domain.ErrFlowIntegrity())
	}
	username, displayName := passkeyRegistrationDisplay(fields, pc.state.CollectedData.UserData)
	return domain.FlowPasskeyRegistrationChallengeParams{
		UserID:      pc.state.CollectedData.UserID,
		Username:    username,
		DisplayName: displayName,
		RPID:        rp.RPID,
		RPOrigins:   rp.Origins,
	}, nil
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
