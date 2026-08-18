package service

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const passkeyRegistrationTTL = 5 * time.Minute
const passkeyRegistrationDefaultUsername = "Passkey account"

// PasskeyRegistrationService is the authoritative service for the passkey registration
// ceremony. It exposes [Begin] and [Finish] for direct callers and is wrapped by
// [FlowPasskeyRegistrationAdapter] for the flow engine.
type PasskeyRegistrationService struct {
	v2Pool StatementPool
}

func NewPasskeyRegistrationService(
	v2Pool StatementPool,
) *PasskeyRegistrationService {
	return &PasskeyRegistrationService{
		v2Pool: v2Pool,
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
	UserID         string
	Options        []byte // PublicKeyCredentialCreationOptions JSON
}

// Begin starts a passkey registration ceremony. Empty UserID is minted via
// the dialect before the challenge is persisted.
func (s *PasskeyRegistrationService) Begin(ctx context.Context, in BeginRegistrationInput) (BeginRegistrationOutput, error) {
	origins, err := parseOrigins(in.RPOrigins)
	if err != nil {
		return BeginRegistrationOutput{}, err
	}

	userID := in.UserID
	if userID == "" {
		userID, err = s.v2Pool.Statements().NewManagedID(string(domain.PrefixUser))
		if err != nil {
			return BeginRegistrationOutput{}, fmt.Errorf("passkey registration: mint user id: %w", err)
		}
	}

	listed, err := s.v2Pool.Statements().ListUserPasskeys(ctx, &database.ListOptions[domain.UserPasskeyField]{
		Filter: database.And(
			database.Equal(database.Col(domain.UserPasskeyFieldProjectID), in.ProjectID),
			database.Equal(database.Col(domain.UserPasskeyFieldUserID), userID),
		),
	})
	if err != nil {
		return BeginRegistrationOutput{}, fmt.Errorf("passkey registration: list passkeys: %w", err)
	}

	username, displayName := passkeyRegistrationLabels(in.Username, in.DisplayName)
	challenge, err := domain.CreatePasskeyRegistrationChallenge(
		userID, username, displayName,
		listed.Items,
		in.RPID, origins,
	)
	if err != nil {
		return BeginRegistrationOutput{}, fmt.Errorf("passkey registration: begin: %w", err)
	}

	reg := &domain.CreatePasskeyRegistration{
		ProjectID: in.ProjectID,
		UserID:    userID,
		Challenge: challenge,
		ExpiresAt: time.Now().Add(passkeyRegistrationTTL),
	}
	if err := s.v2Pool.Statements().CreatePasskeyRegistration(ctx, reg); err != nil {
		return BeginRegistrationOutput{}, fmt.Errorf("passkey registration: store challenge: %w", err)
	}

	chWrapper := &domain.AuthChallengePasskeyRegistration{
		PasskeyRegistrationChallenge: challenge,
	}
	options, err := domain.BuildPasskeyCreationOptions(chWrapper)
	if err != nil {
		return BeginRegistrationOutput{}, fmt.Errorf("passkey registration: build options: %w", err)
	}

	return BeginRegistrationOutput{
		RegistrationID: reg.ID,
		UserID:         userID,
		Options:        options,
	}, nil
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
	// PasskeyName labels the credential in passkey management surfaces.
	// Optional: when empty, a name is derived from the credential itself
	// ([domain.GeneratePasskeyCredentialName]).
	PasskeyName string
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

	newPasskey, err := domain.VerifyPasskeyRegistration(reg.Challenge, in.Attestation, in.PasskeyName)
	if err != nil {
		return domain.ErrAuthAttemptProofRejected(err)
	}
	newPasskey.ProjectID = in.ProjectID
	newPasskey.UserID = reg.UserID

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().CreateUserPasskey(ctx, newPasskey); err != nil {
			return fmt.Errorf("passkey registration: store credential: %w", err)
		}
		if err := audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
			Type:       domain.EventTypeAuthFactorPasskeyEnrolled,
			Category:   domain.EventCategoryAuth,
			ProjectID:  in.ProjectID,
			EntityType: "user_passkey",
			EntityID:   newPasskey.ID,
			Payload: domain.AuthFactorPayload{
				UserID:   reg.UserID,
				FactorID: newPasskey.ID,
			},
		}); err != nil {
			return err
		}
		// Best-effort cleanup; don't shadow the success.
		_ = tx.Statements().DeletePasskeyRegistration(ctx, in.ProjectID, in.RegistrationID)
		return nil
	})
	return err
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
