package service

import (
	"context"
	"fmt"
	"net/url"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const passkeyRegistrationTTL = 5 * time.Minute

// PasskeyRegistrationService implements [domain.FlowPasskeyRegistrationService]
// for the flow engine and provides the standalone /passkeys begin/finish API.
type PasskeyRegistrationService struct {
	pool          database.Pool
	registrations domain.PasskeyRegistrationRepository
	passkeys      domain.UserPasskeyRepository
	sessions      domain.SessionRepository
	ids           idgen.Generator
}

var _ domain.FlowPasskeyRegistrationService = (*PasskeyRegistrationService)(nil)

func NewPasskeyRegistrationService(
	pool database.Pool,
	registrations domain.PasskeyRegistrationRepository,
	passkeys domain.UserPasskeyRepository,
	sessions domain.SessionRepository,
	ids idgen.Generator,
) *PasskeyRegistrationService {
	return &PasskeyRegistrationService{
		pool:          pool,
		registrations: registrations,
		passkeys:      passkeys,
		sessions:      sessions,
		ids:           ids,
	}
}

// IssuePasskeyRegistrationChallenge implements [domain.FlowPasskeyRegistrationService].
// Called by the flow state machine when a step's passkey_register action is selected.
func (s *PasskeyRegistrationService) IssuePasskeyRegistrationChallenge(ctx context.Context, in domain.FlowIssuePasskeyRegistrationChallengeInput) (domain.FlowPasskeyRegistrationChallengeOutput, error) {
	origins, err := parseOrigins(in.RPOrigins)
	if err != nil {
		return domain.FlowPasskeyRegistrationChallengeOutput{}, err
	}

	existing, err := s.listPasskeys(ctx, in.ProjectID, in.UserID)
	if err != nil {
		return domain.FlowPasskeyRegistrationChallengeOutput{}, fmt.Errorf("passkey registration: list passkeys: %w", err)
	}

	challenge, err := domain.CreatePasskeyRegistrationChallenge(
		in.UserID, in.UserID, in.UserID, // username and displayName default to userID for MVP
		existing,
		in.RPID, origins,
	)
	if err != nil {
		return domain.FlowPasskeyRegistrationChallengeOutput{}, fmt.Errorf("passkey registration: begin: %w", err)
	}

	regID, err := s.ids.New(string(domain.PrefixPasskeyRegistration))
	if err != nil {
		return domain.FlowPasskeyRegistrationChallengeOutput{}, fmt.Errorf("passkey registration: generate id: %w", err)
	}

	if err := s.registrations.Create(ctx, s.pool, &domain.CreatePasskeyRegistration{
		ID:        regID,
		ProjectID: in.ProjectID,
		UserID:    in.UserID,
		Challenge: challenge,
		ExpiresAt: time.Now().Add(passkeyRegistrationTTL),
	}); err != nil {
		return domain.FlowPasskeyRegistrationChallengeOutput{}, fmt.Errorf("passkey registration: store challenge: %w", err)
	}

	chWrapper := &domain.AuthChallengePasskeyRegistration{
		PasskeyRegistrationChallenge: challenge,
	}
	options, err := domain.BuildPasskeyCreationOptions(chWrapper)
	if err != nil {
		return domain.FlowPasskeyRegistrationChallengeOutput{}, fmt.Errorf("passkey registration: build options: %w", err)
	}

	return domain.FlowPasskeyRegistrationChallengeOutput{
		ChallengeID: regID,
		Options:     options,
	}, nil
}

// SubmitPasskeyRegistration implements [domain.FlowPasskeyRegistrationService].
// Called by the flow state machine when the attestation is posted.
func (s *PasskeyRegistrationService) SubmitPasskeyRegistration(ctx context.Context, in domain.FlowSubmitPasskeyRegistrationInput) error {
	reg, err := s.registrations.Get(ctx, s.pool, in.ProjectID, in.ChallengeID)
	if err != nil {
		return domain.ErrAuthAttemptProofRejected(err)
	}

	newPasskey, err := domain.VerifyPasskeyRegistration(reg.Challenge, in.Attestation)
	if err != nil {
		return domain.ErrAuthAttemptProofRejected(err)
	}
	newPasskey.ProjectID = in.ProjectID
	newPasskey.UserID = in.UserID

	if err := s.passkeys.Create(ctx, s.pool, newPasskey); err != nil {
		return fmt.Errorf("passkey registration: store credential: %w", err)
	}

	// Best-effort cleanup; don't shadow the success.
	_ = s.registrations.Delete(ctx, s.pool, in.ProjectID, in.ChallengeID)
	return nil
}

// --- Standalone /passkeys API (session-authenticated) ---

// BeginPasskeyRegistrationInput is the input for the standalone begin endpoint.
type BeginPasskeyRegistrationInput struct {
	ProjectID string
	SessionID string
	RPID      string
	RPOrigins []string
}

// BeginPasskeyRegistrationOutput is the response from the standalone begin endpoint.
type BeginPasskeyRegistrationOutput struct {
	RegistrationID string
	Options        []byte // PublicKeyCredentialCreationOptions JSON
}

// BeginPasskeyRegistration starts a registration ceremony for an already-authenticated user.
// The user is resolved from the active session.
func (s *PasskeyRegistrationService) BeginPasskeyRegistration(ctx context.Context, in BeginPasskeyRegistrationInput) (BeginPasskeyRegistrationOutput, error) {
	session, err := s.sessions.Get(ctx, s.pool, in.ProjectID, in.SessionID)
	if err != nil {
		return BeginPasskeyRegistrationOutput{}, err
	}
	if session.UserID == nil {
		return BeginPasskeyRegistrationOutput{}, fmt.Errorf("passkey registration: session has no associated user")
	}
	userID := *session.UserID

	out, err := s.IssuePasskeyRegistrationChallenge(ctx, domain.FlowIssuePasskeyRegistrationChallengeInput{
		ProjectID: in.ProjectID,
		UserID:    userID,
		RPID:      in.RPID,
		RPOrigins: in.RPOrigins,
	})
	if err != nil {
		return BeginPasskeyRegistrationOutput{}, err
	}
	return BeginPasskeyRegistrationOutput{RegistrationID: out.ChallengeID, Options: out.Options}, nil
}

// FinishPasskeyRegistrationInput is the input for the standalone finish endpoint.
type FinishPasskeyRegistrationInput struct {
	ProjectID      string
	RegistrationID string
	Attestation    []byte
}

// FinishPasskeyRegistration completes the registration ceremony and persists the credential.
func (s *PasskeyRegistrationService) FinishPasskeyRegistration(ctx context.Context, in FinishPasskeyRegistrationInput) error {
	reg, err := s.registrations.Get(ctx, s.pool, in.ProjectID, in.RegistrationID)
	if err != nil {
		return err
	}

	newPasskey, err := domain.VerifyPasskeyRegistration(reg.Challenge, in.Attestation)
	if err != nil {
		return domain.ErrAuthAttemptProofRejected(err)
	}
	newPasskey.ProjectID = in.ProjectID
	newPasskey.UserID = reg.UserID

	if err := s.passkeys.Create(ctx, s.pool, newPasskey); err != nil {
		return fmt.Errorf("passkey registration: store credential: %w", err)
	}

	_ = s.registrations.Delete(ctx, s.pool, in.ProjectID, in.RegistrationID)
	return nil
}

func (s *PasskeyRegistrationService) listPasskeys(ctx context.Context, projectID, userID string) ([]*domain.UserPasskey, error) {
	return s.passkeys.List(
		ctx,
		s.pool,
		database.WithCondition(s.passkeys.ProjectIDCondition(projectID)),
		database.WithCondition(s.passkeys.UserIDCondition(userID)),
	)
}

func parseOrigins(raw []string) ([]url.URL, error) {
	origins := make([]url.URL, 0, len(raw))
	for _, o := range raw {
		u, err := url.Parse(o)
		if err != nil {
			return nil, fmt.Errorf("passkey registration: parse origin %q: %w", o, err)
		}
		origins = append(origins, *u)
	}
	return origins, nil
}
