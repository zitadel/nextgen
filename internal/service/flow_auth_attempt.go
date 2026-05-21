package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
)

// FlowAuthAttemptAdapter is the production [domain.FlowAuthAttemptService].
// It collapses each Submit* call into the underlying [AuthAttemptService]
// issue+verify pair so the state machine never sees challenge IDs.
//
// Identifier no-match and password failure both surface as
// [domain.ErrAuthAttemptProofRejected]; callers `errors.Is`-match it.
type FlowAuthAttemptAdapter struct {
	svc AuthAttemptService
}

func NewFlowAuthAttemptAdapter(svc AuthAttemptService) *FlowAuthAttemptAdapter {
	return &FlowAuthAttemptAdapter{svc: svc}
}

var _ domain.FlowAuthAttemptService = (*FlowAuthAttemptAdapter)(nil)

func (a *FlowAuthAttemptAdapter) Start(ctx context.Context, in domain.FlowCreateAttemptInput) (string, error) {
	attempt, err := a.svc.Create(ctx, CreateAuthAttemptInput{
		ProjectID:      in.ProjectID,
		SessionID:      in.SessionID,
		RequiredChecks: in.RequiredChecks,
	})
	if err != nil {
		return "", fmt.Errorf("flow auth attempt adapter: create: %w", err)
	}
	return attempt.ID, nil
}

func (a *FlowAuthAttemptAdapter) SubmitIdentifier(ctx context.Context, in domain.FlowSubmitIdentifierInput) (string, error) {
	issued, err := a.svc.IssueChallenge(ctx, IssueChallengeInput{
		ProjectID: in.ProjectID,
		AttemptID: in.AttemptID,
		Challenge: UserChallenge{},
	})
	if err != nil {
		return "", fmt.Errorf("flow auth attempt adapter: issue user challenge: %w", err)
	}
	verified, err := a.svc.VerifyProof(ctx, VerifyProofInput{
		ProjectID:   in.ProjectID,
		AttemptID:   in.AttemptID,
		ChallengeID: challengeIDFor(issued, domain.AuthCheckTypeUser),
		Proof:       UserProof{LoginName: in.Value},
	})
	if err != nil {
		if errors.Is(err, domain.ErrAuthAttemptProofRejected()) {
			return "", err
		}
		return "", fmt.Errorf("flow auth attempt adapter: verify user proof: %w", err)
	}
	userCheck, ok := domain.CheckAs[*domain.UserAuthCheck](verified, domain.AuthCheckTypeUser)
	if !ok || userCheck.Factor == nil {
		return "", fmt.Errorf("flow auth attempt adapter: user check missing after verify")
	}
	return userCheck.Factor.UserID, nil
}

func (a *FlowAuthAttemptAdapter) SubmitPassword(ctx context.Context, in domain.FlowSubmitPasswordInput) error {
	issued, err := a.svc.IssueChallenge(ctx, IssueChallengeInput{
		ProjectID: in.ProjectID,
		AttemptID: in.AttemptID,
		Challenge: PasswordChallenge{},
	})
	if err != nil {
		return fmt.Errorf("flow auth attempt adapter: issue password challenge: %w", err)
	}
	if _, err := a.svc.VerifyProof(ctx, VerifyProofInput{
		ProjectID:   in.ProjectID,
		AttemptID:   in.AttemptID,
		ChallengeID: challengeIDFor(issued, domain.AuthCheckTypePassword),
		Proof:       PasswordProof{Password: in.Plain},
	}); err != nil {
		if errors.Is(err, domain.ErrAuthAttemptProofRejected()) {
			return err
		}
		return fmt.Errorf("flow auth attempt adapter: verify password proof: %w", err)
	}
	return nil
}

// challengeIDFor extracts the challenge ID for the just-issued check
// from a returned AuthAttempt. The current [domain.AuthCheck] model on
// this branch does not carry an ID field; the auth-attempt service
// implementation will need to surface one (likely on the check itself
// or a separate challenge value). Returning an empty string keeps the
// adapter compilable; when the model lands, this helper picks it up.
//
// TODO(auth-attempt-impl): replace with the real challenge id once the
// auth-attempt domain settles.
func challengeIDFor(attempt *domain.AuthAttempt, typ domain.AuthCheckType) string {
	if attempt == nil {
		return ""
	}
	if _, ok := attempt.CheckByType(typ); !ok {
		return ""
	}
	return ""
}

// ----
// Dummy implementation while auth_attempt svc is not ready
// ----

type DummyFlowAuthAttemptAdapter struct {
	svc AuthAttemptService
}

func NewDummyFlowAuthAttemptAdapter(_ AuthAttemptService) *DummyFlowAuthAttemptAdapter {
	return &DummyFlowAuthAttemptAdapter{}
}

var _ domain.FlowAuthAttemptService = (*DummyFlowAuthAttemptAdapter)(nil)

func (a *DummyFlowAuthAttemptAdapter) Start(ctx context.Context, in domain.FlowCreateAttemptInput) (string, error) {
	return "attempt.ID", nil
}

func (a *DummyFlowAuthAttemptAdapter) SubmitIdentifier(ctx context.Context, in domain.FlowSubmitIdentifierInput) (string, error) {
	return "userCheck.Factor.UserID", nil
}

func (a *DummyFlowAuthAttemptAdapter) SubmitPassword(ctx context.Context, in domain.FlowSubmitPasswordInput) error {
	return nil
}
