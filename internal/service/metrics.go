package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

// credentialResult classifies the outcome of validating a bearer credential
// for the credential validation metric. Anything that is not the bearer's own
// doing -- a read that failed, a key that could not be unwrapped -- is an
// error, so a database outage does not read as a wave of bad credentials.
func credentialResult(err error) metrics.CredentialResult {
	switch {
	case err == nil:
		return metrics.CredentialValid
	case errors.Is(err, domain.ErrTokenRevoked()):
		return metrics.CredentialRevoked
	case errors.Is(err, domain.ErrInvalidToken()), errors.Is(err, domain.ErrEncryptionKeyNotFound()):
		// An unknown key id is a bearer presenting a credential minted for some
		// other deployment, or forged: the credential is at fault.
		return metrics.CredentialInvalid
	default:
		return metrics.CredentialError
	}
}

// authCheckOf names the kind of proof for the authentication outcome metric.
func authCheckOf(proof Proof) metrics.AuthCheck {
	if proof == nil {
		return metrics.AuthCheck(metrics.OtherValue)
	}
	switch proof.proofCheckType() {
	case domain.AuthCheckTypeUser:
		return metrics.CheckUser
	case domain.AuthCheckTypePassword:
		return metrics.CheckPassword
	case domain.AuthCheckTypePasskey:
		return metrics.CheckPasskey
	case domain.AuthCheckTypePasskeyRegistration:
		return metrics.CheckPasskeyRegistration
	default:
		return metrics.AuthCheck(metrics.OtherValue)
	}
}

// authResultOf classifies the outcome of verifying a proof: it worked, it was
// checked and refused, or it could not be completed.
func authResultOf(err error) metrics.AuthResult {
	switch {
	case err == nil:
		return metrics.AuthSuccess
	case errors.Is(err, domain.ErrAuthAttemptProofRejected(nil)):
		return metrics.AuthRejected
	default:
		return metrics.AuthError
	}
}

// NewMeteredFlowService counts every flow engine operation of next as a step
// transition: where it left the flow, never which step it was, because step
// names are defined per project and would make the series count follow the
// number of projects.
//
// It is a wrapper rather than a change to the engine so the engine stays what
// it was: a state machine with no knowledge of telemetry.
func NewMeteredFlowService(next FlowService) FlowService {
	return meteredFlowService{FlowService: next}
}

type meteredFlowService struct{ FlowService }

func (m meteredFlowService) Start(ctx context.Context, req StartFlowRequest) (domain.FlowStepResult, error) {
	result, err := m.FlowService.Start(ctx, req)
	metrics.Default().RecordFlowTransition(ctx, metrics.FlowStart, flowResultOf(result, err))
	return result, err
}

func (m meteredFlowService) Submit(ctx context.Context, req SubmitFlowRequest) (domain.FlowStepResult, error) {
	result, err := m.FlowService.Submit(ctx, req)
	metrics.Default().RecordFlowTransition(ctx, metrics.FlowSubmit, flowResultOf(result, err))
	return result, err
}

func (m meteredFlowService) GetStep(ctx context.Context, req GetFlowStepRequest) (domain.FlowStepResult, error) {
	result, err := m.FlowService.GetStep(ctx, req)
	metrics.Default().RecordFlowTransition(ctx, metrics.FlowRender, flowResultOf(result, err))
	return result, err
}

func flowResultOf(result domain.FlowStepResult, err error) metrics.FlowResult {
	switch {
	case err != nil:
		return metrics.FlowFailed
	case result.HandoffToken != "" || (result.Step != nil && result.Step.Complete != nil):
		return metrics.FlowComplete
	default:
		return metrics.FlowStep
	}
}
