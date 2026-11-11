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
	solutionDomain    = "zitadel:pow:poc:solution:1:"
)

// Binding comes from the caller's trusted state, never from the submitted proof.
// The operation instance identifies the protected scope (for example a flow
// allowed one signup attempt). The caller must consume it atomically before
// performing the operation. Do not put passwords here.
// ExpiresAt is integer Unix seconds, with no client-controlled clock allowance.
type Binding struct {
	ProfileID           string `json:"profile_id"`
	ProjectID           string `json:"project_id"`
	Operation           string `json:"operation"`
	OperationInstanceID string `json:"operation_instance_id"`
	ChallengeID         string `json:"challenge_id"`
	ExpiresAt           int64  `json:"expires_at"`
}

func (b Binding) validate() error {
	for _, value := range []string{b.ProfileID, b.ProjectID, b.Operation, b.OperationInstanceID, b.ChallengeID} {
		if !validBindingString(value) {
			return ErrInvalidBinding
		}
	}
	if b.ExpiresAt <= 0 {
		return ErrInvalidBinding
	}
	return nil
}

func validBindingString(s string) bool {
	return len(s) > 0 && len(s) <= 256 && utf8.ValidString(s)
}

// Keys holds the 256-bit solution MAC key retained in authenticated storage.
// Never reuse cookie or password keys here.
type Keys struct {
	Solution [keySize]byte `json:"-"`
}

func (k Keys) validate() error {
	var zero [keySize]byte
	if subtle.ConstantTimeCompare(k.Solution[:], zero[:]) == 1 {
		return ErrInvalidKeys
	}
	return nil
}

// StoredChallenge contains only server-side data. Body must be retained
// verbatim in authenticated storage (the signup service uses JWE). Intentionally not
// JSON-serializable: use Challenge.Public for the client projection.
type StoredChallenge struct {
	Body []byte `json:"-"`
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
	Protocol string `json:"protocol"`
	Binding
	Salt  string `json:"salt"`
	Nonce string `json:"nonce"`
}

func (b Binding) context(salt, nonce string) challengeContext {
	return challengeContext{Protocol: Protocol, Binding: b, Salt: salt, Nonce: nonce}
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
