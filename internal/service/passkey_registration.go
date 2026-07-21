package service

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/storage/database"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

const passkeyRegistrationTTL = 5 * time.Minute
const passkeyRegistrationDefaultUsername = "Passkey account"

// PasskeyRegistrationService is the authoritative service for the passkey registration
// ceremony. It exposes [Begin] and [Finish] for direct callers and is wrapped by
// [FlowPasskeyRegistrationAdapter] for the flow engine.
type PasskeyRegistrationService struct {
	pool          database.Pool
	v2Pool        StatementPool
	registrations domain.PasskeyRegistrationRepository
	ids           idgen.Generator
}

func NewPasskeyRegistrationService(
	pool database.Pool,
	v2Pool StatementPool,
	registrations domain.PasskeyRegistrationRepository,
	ids idgen.Generator,
) *PasskeyRegistrationService {
	return &PasskeyRegistrationService{
		pool:          pool,
		v2Pool:        v2Pool,
		registrations: registrations,
		ids:           ids,
	}
}

// BeginRegistrationInput carries the parameters needed to start a passkey registration ceremony.
type BeginRegistrationInput struct {
	ProjectID   string
	UserID      string
	Username    string
	DisplayName string
	RPID        string
	RPOrigins   []string
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

	username, displayName := passkeyRegistrationLabels(in.Username, in.DisplayName)
	challenge, err := domain.CreatePasskeyRegistrationChallenge(
		in.UserID, username, displayName,
		existing,
		in.RPID, origins,
	)
	if err != nil {
		return BeginRegistrationOutput{}, fmt.Errorf("passkey registration: begin: %w", err)
	}

	regID, err := s.ids.New(string(domain.PrefixPasskeyRegistration))
	if err != nil {
		return BeginRegistrationOutput{}, fmt.Errorf("passkey registration: generate id: %w", err)
	}

	if err := s.registrations.Create(ctx, s.pool, &domain.CreatePasskeyRegistration{
		ID:        regID,
		ProjectID: in.ProjectID,
		UserID:    in.UserID,
		Challenge: challenge,
		ExpiresAt: time.Now().Add(passkeyRegistrationTTL),
	}); err != nil {
		return BeginRegistrationOutput{}, fmt.Errorf("passkey registration: store challenge: %w", err)
	}

	chWrapper := &domain.AuthChallengePasskeyRegistration{
		PasskeyRegistrationChallenge: challenge,
	}
	options, err := domain.BuildPasskeyCreationOptions(chWrapper)
	if err != nil {
		return BeginRegistrationOutput{}, fmt.Errorf("passkey registration: build options: %w", err)
	}

	return BeginRegistrationOutput{RegistrationID: regID, Options: options}, nil
}

func passkeyRegistrationLabels(username, displayName string) (string, string) {
	username = strings.TrimSpace(username)
	displayName = strings.TrimSpace(displayName)
	if username == "" {
		return passkeyRegistrationDefaultUsername, ""
	}
	if displayName == "" {
		displayName = username
	}
	return username, displayName
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

// FinishWith is like [Finish] but uses the given QueryExecutor for the registration
// session Get/Delete. The credential write uses UserPasskeyStatements on the v2 pool.
func (s *PasskeyRegistrationService) FinishWith(ctx context.Context, client database.QueryExecutor, in FinishRegistrationInput) error {
	reg, err := s.registrations.Get(ctx, client, in.ProjectID, in.RegistrationID)
	if err != nil {
		return err
	}

	newPasskey, err := domain.VerifyPasskeyRegistration(reg.Challenge, in.Attestation)
	if err != nil {
		return domain.ErrAuthAttemptProofRejected(err)
	}
	newPasskey.ProjectID = in.ProjectID
	newPasskey.UserID = reg.UserID

	if err := s.v2Pool.Statements().CreateUserPasskey(ctx, newPasskey); err != nil {
		return fmt.Errorf("passkey registration: store credential: %w", err)
	}

	// Best-effort cleanup; don't shadow the success.
	_ = s.registrations.Delete(ctx, client, in.ProjectID, in.RegistrationID)
	return nil
}

func (s *PasskeyRegistrationService) listPasskeys(ctx context.Context, projectID, userID string) ([]*domain.UserPasskey, error) {
	result, err := s.v2Pool.Statements().ListUserPasskeys(ctx, &v2database.ListOptions[domain.UserPasskeyField]{
		Filter: v2database.And(
			v2database.Equal(v2database.Col(domain.UserPasskeyFieldProjectID), projectID),
			v2database.Equal(v2database.Col(domain.UserPasskeyFieldUserID), userID),
		),
	})
	if err != nil {
		return nil, err
	}
	return result.Items, nil
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
