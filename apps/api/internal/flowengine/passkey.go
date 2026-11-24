package flowengine

import (
	"context"
	"fmt"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
)

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
