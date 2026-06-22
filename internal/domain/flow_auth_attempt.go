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
	// Handoff mints the single-use token the client exchanges for a
	// session. Called by the state machine on the terminal step.
	Handoff(ctx context.Context, in FlowHandoffInput) (FlowHandoffOutput, error)
	// RegisterCreatedUser registers a newly-created user's ID as a verified
	// user factor on the auth attempt. Called after on_success: create_user
	// and passkey registration so that the session gets user_id after exchange.
	RegisterCreatedUser(ctx context.Context, in FlowRegisterCreatedUserInput) error
}

type FlowRegisterCreatedUserInput struct {
	ProjectID string
	AttemptID string
	UserID    string
}

// FlowCreateAttemptInput is the bootstrap input to
// [FlowAuthAttemptService.Start]. SessionID is set only for step-up
// auth; RequiredChecks overrides the project default when pinned.
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

type FlowHandoffInput struct {
	ProjectID string
	AttemptID string
}

type FlowHandoffOutput struct {
	Token     string
	ExpiresAt time.Time
}
