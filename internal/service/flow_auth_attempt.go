package service

import (
	"context"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
)

// FlowAuthAttemptAdapter adapts the broad [AuthAttemptService] surface
// to the narrow [domain.FlowAuthAttemptService] the flow state machine
// consumes. Each Submit* collapses the underlying issue-then-verify
// cycle so the state machine never deals with challenge IDs.
type FlowAuthAttemptAdapter struct {
	attempts AuthAttemptService
}

func NewFlowAuthAttemptAdapter(attempts AuthAttemptService) *FlowAuthAttemptAdapter {
	return &FlowAuthAttemptAdapter{attempts: attempts}
}

var _ domain.FlowAuthAttemptService = (*FlowAuthAttemptAdapter)(nil)

func (a *FlowAuthAttemptAdapter) Start(ctx context.Context, in domain.FlowCreateAttemptInput) (string, error) {
	attempt, err := a.attempts.Create(ctx, CreateAuthAttemptInput{
		ProjectID:      in.ProjectID,
		SessionID:      in.SessionID,
		RequiredChecks: in.RequiredChecks,
	})
	if err != nil {
		return "", err
	}
	return attempt.ID, nil
}

func (a *FlowAuthAttemptAdapter) SubmitIdentifier(ctx context.Context, in domain.FlowSubmitIdentifierInput) (string, error) {
	challengeID, err := a.issueChallengeID(ctx, in.ProjectID, in.AttemptID, UserChallenge{}, domain.AuthCheckTypeUser)
	if err != nil {
		return "", err
	}
	attempt, err := a.attempts.VerifyProof(ctx, VerifyProofInput{
		ProjectID:   in.ProjectID,
		AttemptID:   in.AttemptID,
		ChallengeID: challengeID,
		Proof: UserProof{
			AttributeName: in.AttributeName,
			LoginName:     in.Value,
		},
	})
	if err != nil {
		return "", err
	}
	factor, ok := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
	if !ok {
		return "", fmt.Errorf("flow auth-attempt adapter: user factor missing after verify")
	}
	return factor.UserID, nil
}

func (a *FlowAuthAttemptAdapter) Handoff(ctx context.Context, in domain.FlowHandoffInput) (domain.FlowHandoffOutput, error) {
	attempt, err := a.attempts.Handoff(ctx, HandoffInput{
		ProjectID: in.ProjectID,
		AttemptID: in.AttemptID,
	})
	if err != nil {
		return domain.FlowHandoffOutput{}, err
	}
	if attempt.HandoffToken == nil {
		return domain.FlowHandoffOutput{}, fmt.Errorf("flow auth-attempt adapter: handoff token missing after handoff")
	}
	return domain.FlowHandoffOutput{
		Token:     attempt.HandoffToken.Plain(),
		ExpiresAt: attempt.HandoffToken.ExpiresAt(attempt.HandedOffAt),
	}, nil
}

func (a *FlowAuthAttemptAdapter) SubmitPassword(ctx context.Context, in domain.FlowSubmitPasswordInput) error {
	challengeID, err := a.issueChallengeID(ctx, in.ProjectID, in.AttemptID, PasswordChallenge{}, domain.AuthCheckTypePassword)
	if err != nil {
		return err
	}
	_, err = a.attempts.VerifyProof(ctx, VerifyProofInput{
		ProjectID:   in.ProjectID,
		AttemptID:   in.AttemptID,
		ChallengeID: challengeID,
		Proof:       PasswordProof{Password: in.Plain},
	})
	return err
}

func (a *FlowAuthAttemptAdapter) issueChallengeID(ctx context.Context, projectID, attemptID string, challenge Challenge, typ domain.AuthCheckType) (string, error) {
	attempt, err := a.attempts.IssueChallenge(ctx, IssueChallengeInput{
		ProjectID: projectID,
		AttemptID: attemptID,
		Challenge: challenge,
	})
	if err != nil {
		return "", err
	}
	ch, ok := attempt.ChallengeByType(typ)
	if !ok {
		return "", fmt.Errorf("flow auth-attempt adapter: challenge %d missing after issue", typ)
	}
	return ch.GetID(), nil
}
