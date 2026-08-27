package service

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"

	"github.com/zitadel/nextgen/internal/domain"
)

// FlowAuthAttemptAdapter adapts the broad [AuthAttemptService] surface
// to the narrow [domain.FlowAuthAttemptService] the flow state machine
// consumes. Each Submit* collapses the underlying issue-then-verify
// cycle so the state machine never deals with challenge IDs.
type FlowAuthAttemptAdapter struct {
	attempts AuthAttemptService
	// personalTeams, when wired, runs the platform project's registration side
	// effect after a created user is registered on the attempt (#527). Optional
	// via the chainable setter so the adapter's constructor call sites stay
	// untouched.
	personalTeams PersonalTeamEnsurer
}

func NewFlowAuthAttemptAdapter(attempts AuthAttemptService) *FlowAuthAttemptAdapter {
	return &FlowAuthAttemptAdapter{attempts: attempts}
}

// WithPersonalTeamEnsurer wires the platform registration side effect. The
// adapter is the one funnel every flow-created user passes through — the
// password path's on_success and the passkey path's post-attestation
// registration both land in RegisterCreatedUser — which is what makes the
// side effect credential-agnostic without the flow engine knowing about teams.
func (a *FlowAuthAttemptAdapter) WithPersonalTeamEnsurer(e PersonalTeamEnsurer) *FlowAuthAttemptAdapter {
	a.personalTeams = e
	return a
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

// IssuePasskeyChallenge issues a WebAuthn assertion challenge and returns its id
// plus the PublicKeyCredentialRequestOptions the browser hands to
// navigator.credentials.get(). Unlike the other Submit* methods it does not
// verify — the assertion arrives on a later submit (see [SubmitPasskey]).
func (a *FlowAuthAttemptAdapter) IssuePasskeyChallenge(ctx context.Context, in domain.FlowIssuePasskeyChallengeInput) (domain.FlowPasskeyChallengeOutput, error) {
	origins := make([]url.URL, 0, len(in.RPOrigins))
	for _, o := range in.RPOrigins {
		u, err := url.Parse(o)
		if err != nil {
			return domain.FlowPasskeyChallengeOutput{}, fmt.Errorf("flow auth-attempt adapter: parse rp origin %q: %w", o, err)
		}
		origins = append(origins, *u)
	}

	attempt, err := a.attempts.IssueChallenge(ctx, IssueChallengeInput{
		ProjectID: in.ProjectID,
		AttemptID: in.AttemptID,
		Challenge: PasskeyChallenge{
			UserVerification: in.UserVerification,
			RPID:             in.RPID,
			RPOrigins:        origins,
		},
	})
	if err != nil {
		return domain.FlowPasskeyChallengeOutput{}, err
	}

	ch, ok := attempt.ChallengeByType(domain.AuthCheckTypePasskey)
	if !ok {
		return domain.FlowPasskeyChallengeOutput{}, fmt.Errorf("flow auth-attempt adapter: passkey challenge missing after issue")
	}
	passkeyCh, ok := ch.(*domain.AuthChallengePasskey)
	if !ok {
		return domain.FlowPasskeyChallengeOutput{}, fmt.Errorf("flow auth-attempt adapter: unexpected passkey challenge type %T", ch)
	}
	options, err := domain.BuildPasskeyRequestOptions(passkeyCh)
	if err != nil {
		return domain.FlowPasskeyChallengeOutput{}, fmt.Errorf("flow auth-attempt adapter: build passkey options: %w", err)
	}
	return domain.FlowPasskeyChallengeOutput{ChallengeID: ch.GetID(), Options: options}, nil
}

// SubmitPasskey verifies the assertion against the challenge identified by
// ChallengeID and returns the authenticated user id (resolved from the
// assertion for a discoverable login, or the already-pinned user otherwise).
func (a *FlowAuthAttemptAdapter) SubmitPasskey(ctx context.Context, in domain.FlowSubmitPasskeyInput) (string, error) {
	attempt, err := a.attempts.VerifyProof(ctx, VerifyProofInput{
		ProjectID:   in.ProjectID,
		AttemptID:   in.AttemptID,
		ChallengeID: in.ChallengeID,
		Proof:       PasskeyProof{AssertionResponse: in.Assertion},
	})
	if err != nil {
		return "", err
	}
	factor, ok := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
	if !ok {
		return "", fmt.Errorf("flow auth-attempt adapter: user factor missing after passkey verify")
	}
	return factor.UserID, nil
}

// RegisterCreatedUser registers a newly-created user's ID as a verified user
// factor on the auth attempt. Delegates to the service layer which issues a
// synthetic challenge and immediately marks it succeeded.
func (a *FlowAuthAttemptAdapter) RegisterCreatedUser(ctx context.Context, in domain.FlowRegisterCreatedUserInput) error {
	if err := a.attempts.RegisterCreatedUser(ctx, in.ProjectID, in.AttemptID, in.UserID); err != nil {
		return err
	}
	// Best-effort by design: the user and their factor are committed, so the
	// flow step must not fail on the side effect. A miss self-heals on the
	// next session exchange, and claim/complete's 403 stays the honest floor.
	if a.personalTeams != nil {
		if err := a.personalTeams.EnsurePersonalTeam(ctx, in.ProjectID, in.UserID); err != nil {
			slog.WarnContext(ctx, "personal team ensure failed after registration",
				slog.String("project_id", in.ProjectID),
				slog.String("user_id", in.UserID),
				slog.Any("error", err))
		}
	}
	return nil
}
