package flow

import "context"

// AuthAttemptService is the flow engine's Go-level handle on the
// auth_attempts primitives. It never speaks HTTP. The state machine reads
// [CompleteResult.AssuranceLevels] to feed implicit policy.
//
// Complete is the only operation that writes factors back to the session
// and bumps the session version. The flow engine never writes to sessions
// directly — the adapter does.
type AuthAttemptService interface {
	Start(ctx context.Context, in StartAttemptInput) (Attempt, error)
	IssueChallenge(ctx context.Context, attemptID string, kind ChallengeKind) (Challenge, error)
	VerifyProof(ctx context.Context, attemptID, challengeID string, proof Proof) (VerifyResult, error)
	Complete(ctx context.Context, attemptID string) (CompleteResult, error)
}

// AttemptPurpose narrows the scope of an in-flight attempt. Used to gate
// which credential types and which sessions the attempt may write to.
type AttemptPurpose uint8

const (
	AttemptPurposeUnspecified AttemptPurpose = iota
	AttemptPurposeLogin
	AttemptPurposeReauth
	AttemptPurposeStepUp
	AttemptPurposeRecovery
)

// ChallengeKind identifies the credential type a challenge exercises.
type ChallengeKind uint8

const (
	ChallengeKindUnspecified ChallengeKind = iota
	ChallengeKindPassword
	ChallengeKindPasskey
	ChallengeKindTOTP
	ChallengeKindOOBSMS
	ChallengeKindOOBEmail
)

// StartAttemptInput is the input to [AuthAttemptService.Start].
type StartAttemptInput struct {
	SessionID string
	UserHint  *UserHint // already-resolved identifier, if any
	Purpose   AttemptPurpose
}

// UserHint carries a resolved identifier that lets the auth-attempt
// service skip a separate identifier lookup.
type UserHint struct {
	UserID *string
	Email  *string
	Phone  *string
}

// Attempt is an opaque handle on an in-flight auth_attempt row.
type Attempt struct {
	ID        string
	SessionID string
	Purpose   AttemptPurpose
}

// Challenge is the credential-specific challenge payload the engine
// hands back to the client (e.g. a WebAuthn challenge blob).
type Challenge struct {
	ID      string
	Kind    ChallengeKind
	Payload map[string]any
}

// Proof is the client's response to a [Challenge].
type Proof struct {
	Kind    ChallengeKind
	Payload map[string]any
}

// VerifyResult is the output of [AuthAttemptService.VerifyProof].
type VerifyResult struct {
	Verified      bool
	FactorsAdded  []SessionFactor
	NextChallenge *Challenge // non-nil when the engine should issue another (MFA chain)
}

// SessionFactor names a factor the session has acquired via this attempt.
type SessionFactor struct {
	Kind     ChallengeKind
	Acquired bool
}

// CompleteResult is the output of [AuthAttemptService.Complete].
type CompleteResult struct {
	SessionID       string
	AssuranceLevels []string
}
