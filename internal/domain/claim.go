package domain

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"time"
)

const (
	PrefixClaim          ResourcePrefix = "claim"
	PrefixClaimChallenge ResourcePrefix = "claim_challenge"
)

// ClaimChallengeTTL is the challenge lifetime (ADR 046 §3).
const ClaimChallengeTTL = 10 * time.Minute

// ClaimWindow is how long after creation an unclaimed project can still be
// claimed (the epic's 14-day lifetime, enforced at claim time; ADR 046
// §Non-goals records that nothing deletes the project when it closes).
// Keep in sync with CLAIM_WINDOW_DAYS in apps/cli/src/lib/claim-state.ts,
// which prints the deadline this constant enforces.
const ClaimWindow = 14 * 24 * time.Hour

// NewClaimChallengeToken mints the plaintext challenge token and the stored
// challenge id (handoff-token pattern, ADR 046 §3): 128 bits of crypto/rand,
// prefixed and base64url-encoded. Only the id — the SHA-256 of the plaintext —
// is ever persisted; the plaintext travels in the claim_url and the CLI poll.
//
// The plaintext uses the wire prefix "ch_" (challenge-id.yaml pins
// ^ch_[a-zA-Z0-9_-]+$, shared with the api-mock and CLI, and ogen validates it
// on input and output). PrefixClaimChallenge stays for error codes only; the
// stored id is an unprefixed hex digest either way.
func NewClaimChallengeToken() (plain, id string, err error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", "", ErrInternal(err).WithMessage("failed to generate claim challenge token")
	}
	plain = "ch_" + base64.RawURLEncoding.EncodeToString(b)
	return plain, HashClaimChallengeToken(plain), nil
}

// HashClaimChallengeToken derives the stored challenge id from a presented
// plaintext token. The claim_challenges.id column is TEXT, so unlike the
// handoff token's raw []byte hash this one is hex-encoded.
func HashClaimChallengeToken(plain string) string {
	return HashSecret(plain)
}

// HashSecret is the proof-of-possession hash of a presented bearer string
// (ADR 029): hex-encoded SHA-256. HandleOAuth2 stores it on claim init and the
// claim service compares it on claim/status with a constant-time compare, so
// the handler, domain, and tests must all derive it from this one definition.
func HashSecret(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

// ClaimConflictDetails is the client-facing details body of the 409
// already_claimed response: the owning team and where to manage the project.
type ClaimConflictDetails struct {
	TeamID       string `json:"team_id"`
	DashboardURL string `json:"dashboard_url"`
}

// ErrClaimNoPersonalTeam covers a claim/complete session user without an
// active personal team. Impossible once #527's registration auto-creates it;
// until then it guards manually seeded platform projects.
func ErrClaimNoPersonalTeam() Error {
	return newError(PrefixClaim.ErrorCodePrefix("no_personal_team"), "The user has no active personal team in the platform project.", nil, nil)
}

// ErrPersonalTeamNotActive covers a platform user whose personal team exists
// but is not active: the membership was flipped, or the team was deactivated
// and cascaded the membership to removed.
//
// Deliberately distinct from ErrClaimNoPersonalTeam. "You hold no membership"
// is provisioned automatically on the next sign-in, while a membership that is
// not active will not be provisioned around, so a UI has to say different
// things about them.
//
// What clears it depends on the status, which is why Details carries it rather
// than the message summarising one cause: `removed` follows a team or user
// deactivation and needs an administrator, while `pending` is an invitation
// the user can still accept.
func ErrPersonalTeamNotActive(status string) Error {
	return newError(
		PrefixClaim.ErrorCodePrefix("personal_team_not_active"),
		"The user's personal team in the platform project is not active.",
		PersonalTeamNotActiveDetails{MembershipStatus: status},
		nil,
	)
}

// PersonalTeamNotActiveDetails names the membership state that blocked the
// personal-team resolution.
type PersonalTeamNotActiveDetails struct {
	MembershipStatus string `json:"membership_status"`
}

// The claim session sentinels are internal diagnostics for the claim/complete
// session precondition (ADR 046 §2). On the wire they are always wrapped in
// auth.unauthorized (401): the caller learns only that the session credential
// was rejected. They exist as distinct values so logs and Claim E2's tests can
// tell the failure modes apart.

func ErrClaimSessionWrongProject() Error {
	return newError(PrefixClaim.ErrorCodePrefix("session_wrong_project"), "The session does not belong to the platform project.", nil, nil)
}

func ErrClaimSessionExpired() Error {
	return newError(PrefixClaim.ErrorCodePrefix("session_expired"), "The session has expired.", nil, nil)
}

func ErrClaimSessionNotActive() Error {
	return newError(PrefixClaim.ErrorCodePrefix("session_not_active"), "The session is not active: it has no verified factor or no resolved user.", nil, nil)
}

// ClaimChallengeStatus is the lifecycle state of a claim challenge. It mirrors
// the DB CHECK on claim_challenges.status.
type ClaimChallengeStatus string

const (
	ClaimChallengeStatusPending   ClaimChallengeStatus = "pending"
	ClaimChallengeStatusCompleted ClaimChallengeStatus = "completed"
)

func (s ClaimChallengeStatus) String() string { return string(s) }

func ErrClaimChallengeInvalid() Error {
	return newError(PrefixClaimChallenge.ErrorCodePrefix("invalid"), "The claim challenge is invalid. Expected a non-empty id, project id, and initiating secret hash.", nil, nil)
}

func ErrClaimChallengeNotFound() Error {
	return newError(PrefixClaimChallenge.ErrorCodePrefix("not_found"), "claim challenge not found", nil, nil)
}

// ClaimChallenge is the ephemeral proof-of-possession record for a project
// claim (ADR 046). Its ID is the SHA-256 hash of a handoff-token-style
// challenge token minted by the caller: the plaintext travels outside the
// system, only the hash is stored.
type ClaimChallenge struct {
	// ID is the SHA-256 hash of the challenge token. It is the primary key and
	// is supplied by the caller, not minted here.
	ID string
	// ProjectID links to [Project].
	ProjectID string
	// InitiatingSecretHash is the SHA-256 of the project secret that initiated
	// the claim; it proves possession on claim/status (see Claim E1).
	InitiatingSecretHash string
	Status               ClaimChallengeStatus
	ExpiresAt            time.Time
	CreatedAt            time.Time
}

// NewClaimChallenge builds a pending claim challenge. Unlike managed resources
// the ID is not minted here: it is the externally computed SHA-256 hash of the
// challenge token (handoff-token pattern, ADR 046 §3).
func NewClaimChallenge(id, projectID, initiatingSecretHash string, expiresAt time.Time) (*ClaimChallenge, error) {
	if id == "" || projectID == "" || initiatingSecretHash == "" {
		return nil, ErrClaimChallengeInvalid()
	}
	return &ClaimChallenge{
		ID:                   id,
		ProjectID:            projectID,
		InitiatingSecretHash: initiatingSecretHash,
		Status:               ClaimChallengeStatusPending,
		ExpiresAt:            expiresAt,
	}, nil
}
