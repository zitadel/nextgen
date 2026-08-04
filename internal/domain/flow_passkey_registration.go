package domain

import (
	"context"
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
	// [ErrAuthAttemptProofRejected].
	SubmitPasskeyRegistration(ctx context.Context, in FlowSubmitPasskeyRegistrationInput) error
}

// FlowIssuePasskeyRegistrationChallengeInput carries the relying-party
// parameters and the user context needed to begin a registration ceremony.
// UserID is the stable WebAuthn user handle; Username and DisplayName are
// browser-visible labels when the flow has a collected identifier.
type FlowIssuePasskeyRegistrationChallengeInput struct {
	ProjectID   string
	UserID      string
	Username    string
	DisplayName string
	RPID        string
	RPOrigins   []string
}

// FlowPasskeyRegistrationChallengeOutput is the issued challenge.
// UserID is the WebAuthn user handle (minted by the registration service when
// the issue input had none).
type FlowPasskeyRegistrationChallengeOutput struct {
	ChallengeID string
	UserID      string
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
