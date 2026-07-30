package service

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

const passkeyRegistrationTTL = 5 * time.Minute
const passkeyRegistrationDefaultUsername = "Passkey account"

// PasskeyRegistrationService is the authoritative service for the passkey registration
// ceremony. It exposes [Begin] and [Finish] for direct callers and is wrapped by
// [FlowPasskeyRegistrationAdapter] for the flow engine.
type PasskeyRegistrationService struct {
	v2Pool StatementPool
	ids    idgen.Generator
}

func NewPasskeyRegistrationService(
	v2Pool StatementPool,
	ids idgen.Generator,
) *PasskeyRegistrationService {
	return &PasskeyRegistrationService{
		v2Pool: v2Pool,
		ids:    ids,
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

	listed, err := s.v2Pool.Statements().ListUserPasskeys(ctx, &database.ListOptions[domain.UserPasskeyField]{
		Filter: database.And(
			database.Equal(database.Col(domain.UserPasskeyFieldProjectID), in.ProjectID),
			database.Equal(database.Col(domain.UserPasskeyFieldUserID), in.UserID),
		),
	})
	if err != nil {
		return BeginRegistrationOutput{}, fmt.Errorf("passkey registration: list passkeys: %w", err)
	}

	username, displayName := passkeyRegistrationLabels(in.Username, in.DisplayName)
	challenge, err := domain.CreatePasskeyRegistrationChallenge(
		in.UserID, username, displayName,
		listed.Items,
		in.RPID, origins,
	)
	if err != nil {
		return BeginRegistrationOutput{}, fmt.Errorf("passkey registration: begin: %w", err)
	}

	regID, err := s.ids.New(string(domain.PrefixPasskeyRegistration))
	if err != nil {
		return BeginRegistrationOutput{}, fmt.Errorf("passkey registration: generate id: %w", err)
	}

	if err := s.v2Pool.Statements().CreatePasskeyRegistration(ctx, &domain.CreatePasskeyRegistration{
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
	stmts := s.v2Pool.Statements()
	reg, err := stmts.GetPasskeyRegistration(ctx, in.ProjectID, in.RegistrationID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return domain.ErrPasskeyRegistrationNotFound()
		}
		return err
	}

	newPasskey, err := domain.VerifyPasskeyRegistration(reg.Challenge, in.Attestation)
	if err != nil {
		return domain.ErrAuthAttemptProofRejected(err)
	}
	newPasskey.ProjectID = in.ProjectID
	newPasskey.UserID = reg.UserID

	if err := stmts.CreateUserPasskey(ctx, newPasskey); err != nil {
		return fmt.Errorf("passkey registration: store credential: %w", err)
	}

	// Best-effort cleanup; don't shadow the success.
	_ = stmts.DeletePasskeyRegistration(ctx, in.ProjectID, in.RegistrationID)
	return nil
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
