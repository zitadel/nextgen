package service

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// FlowPasskeyRegistrationAdapter wraps [*PasskeyRegistrationService] and implements
// the narrow [domain.FlowPasskeyRegistrationService] interface consumed by the flow
// engine. It translates flow input/output types to the canonical service API.
type FlowPasskeyRegistrationAdapter struct {
	svc *PasskeyRegistrationService
}

// NewFlowPasskeyRegistrationAdapter returns a new adapter wrapping svc.
func NewFlowPasskeyRegistrationAdapter(svc *PasskeyRegistrationService) *FlowPasskeyRegistrationAdapter {
	return &FlowPasskeyRegistrationAdapter{svc: svc}
}

var _ domain.FlowPasskeyRegistrationService = (*FlowPasskeyRegistrationAdapter)(nil)

// IssuePasskeyRegistrationChallenge implements [domain.FlowPasskeyRegistrationService].
func (a *FlowPasskeyRegistrationAdapter) IssuePasskeyRegistrationChallenge(ctx context.Context, in domain.FlowIssuePasskeyRegistrationChallengeInput) (domain.FlowPasskeyRegistrationChallengeOutput, error) {
	out, err := a.svc.Begin(ctx, BeginRegistrationInput{
		ProjectID:   in.ProjectID,
		UserID:      in.UserID,
		Username:    in.Username,
		DisplayName: in.DisplayName,
		RPID:        in.RPID,
		RPOrigins:   in.RPOrigins,
	})
	if err != nil {
		return domain.FlowPasskeyRegistrationChallengeOutput{}, err
	}
	return domain.FlowPasskeyRegistrationChallengeOutput{
		ChallengeID: out.RegistrationID,
		Options:     out.Options,
	}, nil
}

// SubmitPasskeyRegistration implements [domain.FlowPasskeyRegistrationService].
// The flow engine still passes a v1 QueryExecutor; passkey persistence uses the
// service's v2 statement pool (provisional user creation is a separate ApplyActions txn).
func (a *FlowPasskeyRegistrationAdapter) SubmitPasskeyRegistration(ctx context.Context, _ database.QueryExecutor, in domain.FlowSubmitPasskeyRegistrationInput) error {
	return a.svc.Finish(ctx, FinishRegistrationInput{
		ProjectID:      in.ProjectID,
		RegistrationID: in.ChallengeID,
		Attestation:    in.Attestation,
	})
}
