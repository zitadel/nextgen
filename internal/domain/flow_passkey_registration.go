package domain

import (
	"context"

	"github.com/zitadel/nextgen/internal/storage/database"
)

//go:generate go tool mockgen -typed -package domainmock -destination ./mock/flow_passkey_registration.mock.go . FlowPasskeyRegistrationService

// FlowPasskeyRegistrationService is the flow engine's narrow view of the
// passkey registration ceremony. It is intentionally separate from
// [FlowAuthAttemptService]: credential enrollment is distinct from identity
// verification.
type FlowPasskeyRegistrationService interface {
	// IssuePasskeyRegistrationChallenge mints a WebAuthn registration challenge
	// and returns its id plus the PublicKeyCredentialCreationOptions the browser
	// passes to navigator.credentials.create().
	IssuePasskeyRegistrationChallenge(ctx context.Context, in FlowIssuePasskeyRegistrationChallengeInput) (FlowPasskeyRegistrationChallengeOutput, error)

	// SubmitPasskeyRegistration verifies the attestation against the issued
	// challenge and persists the new credential. Rejection surfaces as
	// [ErrAuthAttemptProofRejected]. client is the DB transaction from the
	// flow state machine so the passkey save is atomic with user creation.
	SubmitPasskeyRegistration(ctx context.Context, client database.QueryExecutor, in FlowSubmitPasskeyRegistrationInput) error
}

// FlowIssuePasskeyRegistrationChallengeInput carries the relying-party
// parameters and the user context needed to begin a registration ceremony.
// UserID must already be resolved on the attempt before this is called.
type FlowIssuePasskeyRegistrationChallengeInput struct {
	ProjectID        string
	UserID           string
	Username         string
	RPID             string
	RPOrigins        []string
	UserVerification string
}

// FlowPasskeyRegistrationChallengeOutput is the issued challenge.
// Options is the PublicKeyCredentialCreationOptions JSON the client hands
// to navigator.credentials.create().
type FlowPasskeyRegistrationChallengeOutput struct {
	ChallengeID string
	Options     []byte
}

// FlowSubmitPasskeyRegistrationInput carries the attestation (Attestation)
// plus the ChallengeID returned by IssuePasskeyRegistrationChallenge.
type FlowSubmitPasskeyRegistrationInput struct {
	ProjectID   string
	UserID      string
	ChallengeID string
	Attestation []byte
}
