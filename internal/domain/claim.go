package domain

import (
	"time"
)

const (
	PrefixClaimChallenge ResourcePrefix = "claim_challenge"
)

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
