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
// When client is a v2 Statementer, credential writes join that transaction;
// otherwise the service pool is used.
func (a *FlowPasskeyRegistrationAdapter) SubmitPasskeyRegistration(ctx context.Context, client database.QueryExecutor, in domain.FlowSubmitPasskeyRegistrationInput) error {
	finishIn := FinishRegistrationInput{
		ProjectID:      in.ProjectID,
		RegistrationID: in.ChallengeID,
		Attestation:    in.Attestation,
	}
	if tx, ok := client.(Statementer[AllStatements]); ok {
		return a.svc.FinishWith(ctx, tx.Statements(), finishIn)
	}
	return a.svc.Finish(ctx, finishIn)
}
