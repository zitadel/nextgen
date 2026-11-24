package flowengine

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// FlowAuthAttemptService is the [FlowStateMachine]'s narrow view of the
// auth-attempt domain. Submit* calls collapse the underlying
// issue-then-verify cycle so the state machine never sees challenge
// IDs. Identifier no-match and password failure surface as
// [domain.ErrAuthAttemptProofRejected] (use [errors.Is]).
//
// A two-phase ceremony (a passkey sign-in or registration) cannot collapse
// issue and verify into one call: [IssueChallenge] mints what the client
// runs, and [VerifyChallenge] checks the proof it returns. Both are generic
// over the check type, so a new ceremony adds a [FlowChallengeParams], not a
// method. The state machine threads the challenge id between the two via
// [FlowState.PendingChallenge].
type FlowAuthAttemptService interface {
	Start(ctx context.Context, in FlowCreateAttemptInput) (attemptID string, err error)
	SubmitIdentifier(ctx context.Context, in FlowSubmitIdentifierInput) (userID string, err error)
	SubmitPassword(ctx context.Context, in FlowSubmitPasswordInput) error
	// IssueChallenge mints a challenge of the params' check type on the
	// attempt and returns its id plus the options the client runs the
	// ceremony with.
	IssueChallenge(ctx context.Context, in FlowIssueChallengeInput) (FlowIssuedChallenge, error)
	// VerifyChallenge verifies the proof against the issued challenge and
	// returns the user it authenticated; a check whose user is bound at
	// issue returns none. Rejection surfaces as
	// [domain.ErrAuthAttemptProofRejected], an expired challenge as
	// [domain.ErrAuthAttemptStaleChallenge], and a ceremony whose new user
	// conflicts with an existing one as [domain.ErrUserAlreadyExists].
	VerifyChallenge(ctx context.Context, in FlowVerifyChallengeInput) (userID string, err error)
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
	FlowID         string
	SessionID      *string
	RequiredChecks []domain.AuthCheckType
}

// FlowSubmitIdentifierInput names the submitted identifier field
// (AttributeName, e.g. "email") and the user-entered value the
// auth-attempt service resolves to a user. UserSchemaURL is the schema the
// flow is bound to: the lookup matches only users of its revisions.
// Register is set when the flow is signing someone up: the lookup then asks
// whether the identifier is free, and no match is not a failed sign-in.
type FlowSubmitIdentifierInput struct {
	ProjectID     string
	AttemptID     string
	AttributeName string
	Value         string
	UserSchemaURL string
	Register      bool
}

type FlowSubmitPasswordInput struct {
	ProjectID string
	AttemptID string
	Plain     string
}

// FlowIssueChallengeInput names the attempt a ceremony runs on and what the
// challenge is issued with.
type FlowIssueChallengeInput struct {
	ProjectID string
	AttemptID string
	Params    FlowChallengeParams
}

// FlowChallengeParams is what one check type's ceremony is issued with.
type FlowChallengeParams interface {
	CheckType() domain.AuthCheckType
}

// FlowPasskeyChallengeParams carries the WebAuthn relying-party parameters
// the engine derives from the request. RPOrigins are the allowed origins;
// UserVerification is the requirement (empty defaults to the library
// default). RP params are needed only at issue time — verification re-reads
// them from the persisted challenge.
type FlowPasskeyChallengeParams struct {
	RPID             string
	RPOrigins        []string
	UserVerification string
}

func (FlowPasskeyChallengeParams) CheckType() domain.AuthCheckType {
	return domain.AuthCheckTypePasskey
}

// FlowPasskeyRegistrationChallengeParams carries the relying-party
// parameters and the user context needed to begin a registration ceremony.
// UserID is the stable WebAuthn user handle (empty on a fresh sign-up: the
// attempt service mints a provisional one); Username and DisplayName are
// browser-visible labels when the flow has a collected identifier.
type FlowPasskeyRegistrationChallengeParams struct {
	UserID      string
	Username    string
	DisplayName string
	RPID        string
	RPOrigins   []string
}

func (FlowPasskeyRegistrationChallengeParams) CheckType() domain.AuthCheckType {
	return domain.AuthCheckTypePasskeyRegistration
}

// FlowIssuedChallenge is the issued challenge. Options is the JSON the client
// hands to its authenticator (for passkey, the PublicKeyCredential request or
// creation options); ChallengeID binds the later proof to this issue. UserID
// is the user a check binds at issue: a registration's WebAuthn user handle,
// minted by the attempt service when the params had none. Provisional is true
// when verifying the proof creates that user.
type FlowIssuedChallenge struct {
	ChallengeID string
	UserID      string
	Options     []byte
	Provisional bool
}

// FlowVerifyChallengeInput carries the client's Proof for the challenge
// ChallengeID of type Check. SignUp is set for a check whose verification may
// create the attempt's user.
type FlowVerifyChallengeInput struct {
	ProjectID   string
	AttemptID   string
	Check       domain.AuthCheckType
	ChallengeID string
	Proof       []byte
	SignUp      *FlowChallengeSignUp
}

// FlowChallengeSignUp feeds the user creation that runs inside the verify
// transaction when the ceremony is provisional. That creation is a sign-up:
// it first spends the proof submitted under [domain.SignupGate] in GateProofs, bound
// to the flow in State.
type FlowChallengeSignUp struct {
	UserSchemaURL  string
	UserAttributes map[string]any
	State          *FlowState
	GateProofs     map[string]string
}

type FlowHandoffInput struct {
	ProjectID string
	AttemptID string
}

type FlowHandoffOutput struct {
	Token     string
	ExpiresAt time.Time
}
