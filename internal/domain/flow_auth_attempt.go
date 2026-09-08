package domain

import (
	"context"
	"time"
)

// FlowAuthAttemptService is the [FlowStateMachine]'s narrow view of the
// auth-attempt domain. Submit* calls collapse the underlying
// issue-then-verify cycle so the state machine never sees challenge
// IDs. Identifier no-match and password failure surface as
// [ErrAuthAttemptProofRejected] (use [errors.Is]).
//
// Passkey is the exception: it is a two-phase WebAuthn ceremony, so it
// cannot collapse issue+verify into one call. [IssuePasskeyChallenge]
// mints the options the browser signs; [SubmitPasskey] verifies the
// returned assertion. The state machine threads the challenge id between
// the two via [FlowState.PendingChallenge].
type FlowAuthAttemptService interface {
	Start(ctx context.Context, in FlowCreateAttemptInput) (attemptID string, err error)
	SubmitIdentifier(ctx context.Context, in FlowSubmitIdentifierInput) (userID string, err error)
	SubmitPassword(ctx context.Context, in FlowSubmitPasswordInput) error
	// IssuePasskeyChallenge mints a WebAuthn assertion challenge and
	// returns its id plus the PublicKeyCredentialRequestOptions the
	// browser passes to navigator.credentials.get().
	IssuePasskeyChallenge(ctx context.Context, in FlowIssuePasskeyChallengeInput) (FlowPasskeyChallengeOutput, error)
	// SubmitPasskey verifies the assertion against the issued challenge
	// and returns the authenticated user id. For a discoverable login the
	// user is resolved from the assertion; for an identified login it is
	// the already-pinned user. Rejection surfaces as
	// [ErrAuthAttemptProofRejected].
	SubmitPasskey(ctx context.Context, in FlowSubmitPasskeyInput) (userID string, err error)
	// IssuePasskeyRegistrationChallenge mints a WebAuthn registration
	// challenge on the attempt and returns its id plus the
	// PublicKeyCredentialCreationOptions the browser passes to
	// navigator.credentials.create(). Enrollment rides the same two-phase
	// ceremony shape as [IssuePasskeyChallenge]/[SubmitPasskey].
	IssuePasskeyRegistrationChallenge(ctx context.Context, in FlowIssuePasskeyRegistrationChallengeInput) (FlowPasskeyRegistrationChallengeOutput, error)
	// SubmitPasskeyRegistration verifies the attestation against the issued
	// challenge and persists the new credential; for a provisional ceremony
	// the user row is created in the same transaction. Rejection surfaces as
	// [ErrAuthAttemptProofRejected]; a conflicting user as
	// [ErrUserAlreadyExists].
	SubmitPasskeyRegistration(ctx context.Context, in FlowSubmitPasskeyRegistrationInput) error
	// Handoff mints the single-use token the client exchanges for a
	// session. Called by the state machine on the terminal step.
	Handoff(ctx context.Context, in FlowHandoffInput) (FlowHandoffOutput, error)
}

// FlowCreateAttemptInput is the bootstrap input to
// [FlowAuthAttemptService.Start]. SessionID carries the session the flow runs
// against — the anonymous one minted at start, or an existing one for step-up
// — so exchange can upgrade it in place; RequiredChecks overrides the project
// default when pinned.
type FlowCreateAttemptInput struct {
	ProjectID      string
	SessionID      *string
	RequiredChecks []AuthCheckType
}

// FlowSubmitIdentifierInput names the submitted identifier field
// (AttributeName, e.g. "email") and the user-entered value the
// auth-attempt service resolves to a user.
type FlowSubmitIdentifierInput struct {
	ProjectID     string
	AttemptID     string
	AttributeName string
	Value         string
}

type FlowSubmitPasswordInput struct {
	ProjectID string
	AttemptID string
	Plain     string
}

// FlowIssuePasskeyChallengeInput carries the WebAuthn relying-party
// parameters the engine derives from the request. RPOrigins are the
// allowed origins; UserVerification is the requirement (empty defaults
// to the library default). RP params are needed only at issue time —
// verification re-reads them from the persisted challenge.
type FlowIssuePasskeyChallengeInput struct {
	ProjectID        string
	AttemptID        string
	RPID             string
	RPOrigins        []string
	UserVerification string
}

// FlowPasskeyChallengeOutput is the issued challenge. Options is the
// PublicKeyCredentialRequestOptions JSON the client hands to the
// authenticator; ChallengeID binds the later assertion to this issue.
type FlowPasskeyChallengeOutput struct {
	ChallengeID string
	Options     []byte
}

// FlowSubmitPasskeyInput carries the signed assertion (Proof) plus the
// ChallengeID returned by [FlowAuthAttemptService.IssuePasskeyChallenge].
type FlowSubmitPasskeyInput struct {
	ProjectID   string
	AttemptID   string
	ChallengeID string
	Assertion   []byte
}

// FlowIssuePasskeyRegistrationChallengeInput carries the relying-party
// parameters and the user context needed to begin a registration ceremony.
// UserID is the stable WebAuthn user handle (empty on a fresh sign-up: the
// attempt service mints a provisional one); Username and DisplayName are
// browser-visible labels when the flow has a collected identifier.
type FlowIssuePasskeyRegistrationChallengeInput struct {
	ProjectID   string
	AttemptID   string
	UserID      string
	Username    string
	DisplayName string
	RPID        string
	RPOrigins   []string
}

// FlowPasskeyRegistrationChallengeOutput is the issued challenge.
// UserID is the WebAuthn user handle (minted by the attempt service when
// the issue input had none).
type FlowPasskeyRegistrationChallengeOutput struct {
	ChallengeID string
	UserID      string
	Options     []byte
}

// FlowSubmitPasskeyRegistrationInput carries the attestation plus the
// ChallengeID returned by IssuePasskeyRegistrationChallenge. UserSchemaURL
// and UserAttributes feed the user creation that runs inside the verify
// transaction when the ceremony is provisional.
type FlowSubmitPasskeyRegistrationInput struct {
	ProjectID      string
	AttemptID      string
	UserID         string
	ChallengeID    string
	Attestation    []byte
	UserSchemaURL  string
	UserAttributes map[string]any
}

type FlowHandoffInput struct {
	ProjectID string
	AttemptID string
}

type FlowHandoffOutput struct {
	Token     string
	ExpiresAt time.Time
}
