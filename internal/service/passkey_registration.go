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

// PasskeyRegistrationService is the authoritative service for the passkey registration
// ceremony. It exposes [Begin] and [Finish] for direct callers and is wrapped by
// [FlowPasskeyRegistrationAdapter] for the flow engine.
type PasskeyRegistrationService struct {
	pool          database.Pool
	registrations domain.PasskeyRegistrationRepository
	passkeys      domain.UserPasskeyRepository
	ids           idgen.Generator
}

func NewPasskeyRegistrationService(
	pool database.Pool,
	registrations domain.PasskeyRegistrationRepository,
	passkeys domain.UserPasskeyRepository,
	ids idgen.Generator,
) *PasskeyRegistrationService {
	return &PasskeyRegistrationService{
		pool:          pool,
		registrations: registrations,
		passkeys:      passkeys,
		ids:           ids,
	}
}

// BeginRegistrationInput carries the parameters needed to start a passkey registration ceremony.
type BeginRegistrationInput struct {
	ProjectID        string
	UserID           string
	Username         string
	RPID             string
	RPOrigins        []string
	UserVerification string
}

// BeginRegistrationOutput is returned by [PasskeyRegistrationService.Begin].
type BeginRegistrationOutput struct {
	RegistrationID string
	Options        []byte // PublicKeyCredentialCreationOptions JSON
}

// Begin starts a passkey registration ceremony for the given user and relying-party
// parameters. It mints a challenge, persists it, and returns the creation options
// for the browser's navigator.credentials.create() call.
func (s *PasskeyRegistrationService) Begin(ctx context.Context, in BeginRegistrationInput) (BeginRegistrationOutput, error) {
	origins, err := parseOrigins(in.RPOrigins)
	if err != nil {
		return BeginRegistrationOutput{}, err
	}

	existing, err := s.listPasskeys(ctx, in.ProjectID, in.UserID)
	if err != nil {
		return BeginRegistrationOutput{}, fmt.Errorf("passkey registration: list passkeys: %w", err)
	}

	ceremony, err := domain.CreatePasskeyRegistrationChallenge(
		in.UserID, in.Username, in.Username,
		existing,
		in.RPID, origins,
		in.UserVerification,
	)
	if err != nil {
		return BeginRegistrationOutput{}, err
	}

	regID, err := s.ids.New(string(domain.PrefixPasskeyRegistration))
	if err != nil {
		return BeginRegistrationOutput{}, fmt.Errorf("passkey registration: generate id: %w", err)
	}

	if err := s.registrations.Create(ctx, s.pool, &domain.CreatePasskeyRegistration{
		ID:        regID,
		ProjectID: in.ProjectID,
		UserID:    in.UserID,
		Challenge: ceremony,
		ExpiresAt: time.Now().Add(passkeyRegistrationTTL),
	}); err != nil {
		return BeginRegistrationOutput{}, fmt.Errorf("passkey registration: store challenge: %w", err)
	}

	return BeginRegistrationOutput{
		RegistrationID: regID,
		Options:        ceremony.ClientOptions(),
	}, nil
}

// FinishRegistrationInput carries the parameters needed to complete a passkey registration.
type FinishRegistrationInput struct {
	ProjectID      string
	RegistrationID string
	Attestation    []byte
}

// Finish verifies the attestation against the stored challenge and persists the new
// credential. The user identity is authoritative from the stored challenge record.
// Rejection surfaces as [domain.ErrAuthAttemptProofRejected].
func (s *PasskeyRegistrationService) Finish(ctx context.Context, in FinishRegistrationInput) error {
	return s.FinishWith(ctx, s.pool, in)
}

// FinishWith is like [Finish] but uses the given QueryExecutor instead of the pool.
// Used by [FlowPasskeyRegistrationAdapter] to run the credential write inside the
// flow engine's transaction so the passkey save is atomic with user creation.
func (s *PasskeyRegistrationService) FinishWith(ctx context.Context, client database.QueryExecutor, in FinishRegistrationInput) error {
	reg, err := s.registrations.Get(ctx, client, in.ProjectID, in.RegistrationID)
	if err != nil {
		return err
	}

	newPasskey, err := domain.VerifyPasskeyRegistrationChallenge(reg.Challenge, in.Attestation)
	if err != nil {
		return domain.ErrAuthAttemptProofRejected(err)
	}
	newPasskey.ProjectID = in.ProjectID
	newPasskey.UserID = reg.UserID

	if err := s.passkeys.Create(ctx, client, newPasskey); err != nil {
		return fmt.Errorf("passkey registration: store credential: %w", err)
	}

	// Best-effort cleanup; don't shadow the success.
	_ = s.registrations.Delete(ctx, client, in.ProjectID, in.RegistrationID)
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
