package pow

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"time"
	"unicode/utf8"
)

const (
	MaxProofBytes     = 2 * 1024
	MaxChallengeBytes = 4 * 1024
	MaxLifetime       = 5 * time.Minute
	saltSize          = 16
	nonceSize         = 16
	keySize           = 32
	prefixSize        = 16
	solutionDomain    = "zitadel:pow:solution:1:"
	parametersDomain  = "zitadel:pow:parameters:1:"
)

// Binding is resolved from server state, never assembled from a submitted proof.
// Empty revision strings mean the corresponding resource is absent. The operation
// instance must pin the protected input/target privately; do not put it here.
// ExpiresAt is integer Unix seconds, with no client-controlled clock allowance.
type Binding struct {
	ProfileID           string
	ProjectID           string
	DeploymentID        string
	ReleaseID           string
	PolicyRevision      string
	ConfigRevision      string
	AttemptID           string
	Operation           string
	OperationInstanceID string
	RequirementID       string
	ChallengeID         string
	Generation          uint64
	ChallengeKeyVersion string
	SolutionKeyVersion  string
	ExpiresAt           int64
}

func (b Binding) validate() error {
	for _, value := range []string{b.ProfileID, b.ProjectID, b.DeploymentID,
		b.ReleaseID, b.AttemptID, b.Operation, b.OperationInstanceID, b.RequirementID,
		b.ChallengeID, b.ChallengeKeyVersion, b.SolutionKeyVersion} {
		if !validBindingString(value) {
			return ErrInvalidBinding
		}
	}
	for _, revision := range []string{b.PolicyRevision, b.ConfigRevision} {
		if revision != "" && !validBindingString(revision) {
			return ErrInvalidBinding
		}
	}
	if b.Generation == 0 || b.ExpiresAt <= 0 {
		return ErrInvalidBinding
	}
	return nil
}

func validBindingString(s string) bool {
	return len(s) > 0 && len(s) <= 256 && utf8.ValidString(s)
}

// Keys are independent, dedicated 256-bit project-purpose keys. The caller must
// resolve non-revoked versions from Binding, retaining old versions only for
// their allowed verification lifetime. Never use cookie or password keys here.
type Keys struct {
	Challenge [keySize]byte `json:"-"`
	Solution  [keySize]byte `json:"-"`
}

func (k Keys) validate() error {
	var zero [keySize]byte
	if subtle.ConstantTimeCompare(k.Challenge[:], zero[:]) == 1 ||
		subtle.ConstantTimeCompare(k.Solution[:], zero[:]) == 1 ||
		subtle.ConstantTimeCompare(k.Challenge[:], k.Solution[:]) == 1 {
		return ErrInvalidKeys
	}
	return nil
}

// StoredChallenge contains only server-side data. Body is B in ADR 019 and must
// be persisted verbatim; MAC authenticates those exact bytes. Intentionally not
// JSON-serializable: use Challenge.Public for the client projection.
type StoredChallenge struct {
	Body []byte `json:"-"`
	MAC  []byte `json:"-"`
}

type PublicChallenge struct {
	Protocol    string    `json:"protocol"`
	ChallengeID string    `json:"challenge_id"`
	ProfileID   string    `json:"profile_id"`
	Salt        string    `json:"salt"`
	Nonce       string    `json:"nonce"`
	KeyPrefix   string    `json:"key_prefix"`
	ExpiresAt   time.Time `json:"expires_at"`
}

type Challenge struct {
	Stored StoredChallenge `json:"-"`
	Public PublicChallenge `json:"-"`
}

type challengeContext struct {
	Protocol            string  `json:"protocol"`
	ProfileID           string  `json:"profile_id"`
	ProjectID           string  `json:"project_id"`
	DeploymentID        string  `json:"deployment_id"`
	ReleaseID           string  `json:"release_id"`
	PolicyRevision      *string `json:"policy_revision"`
	ConfigRevision      *string `json:"config_revision"`
	AttemptID           string  `json:"attempt_id"`
	Operation           string  `json:"operation"`
	OperationInstanceID string  `json:"operation_instance_id"`
	RequirementID       string  `json:"requirement_id"`
	ChallengeID         string  `json:"challenge_id"`
	Generation          uint64  `json:"generation"`
	ChallengeKeyVersion string  `json:"challenge_key_version"`
	SolutionKeyVersion  string  `json:"solution_key_version"`
	ExpiresAt           int64   `json:"expires_at"`
	Salt                string  `json:"salt"`
	Nonce               string  `json:"nonce"`
}

func (b Binding) context(salt, nonce string) challengeContext {
	optional := func(s string) *string {
		if s == "" {
			return nil
		}
		return new(s)
	}
	return challengeContext{
		Protocol: Protocol, ProfileID: b.ProfileID, ProjectID: b.ProjectID,
		DeploymentID: b.DeploymentID, ReleaseID: b.ReleaseID,
		PolicyRevision: optional(b.PolicyRevision), ConfigRevision: optional(b.ConfigRevision),
		AttemptID: b.AttemptID, Operation: b.Operation, OperationInstanceID: b.OperationInstanceID,
		RequirementID: b.RequirementID, ChallengeID: b.ChallengeID, Generation: b.Generation,
		ChallengeKeyVersion: b.ChallengeKeyVersion, SolutionKeyVersion: b.SolutionKeyVersion,
		ExpiresAt: b.ExpiresAt, Salt: salt, Nonce: nonce,
	}
}

type challengeBody struct {
	Context   json.RawMessage `json:"context"`
	KeyPrefix string          `json:"key_prefix"`
	KeyMAC    string          `json:"key_mac"`
}

func authenticate(key []byte, domain string, parts ...[]byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(domain))
	for _, part := range parts {
		h.Write(part)
	}
	return h.Sum(nil)
}

func lowerHex(s string, size int) ([]byte, bool) {
	if len(s) != 2*size {
		return nil, false
	}
	for _, c := range []byte(s) {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return nil, false
		}
	}
	b, err := hex.DecodeString(s)
	return b, err == nil
}
