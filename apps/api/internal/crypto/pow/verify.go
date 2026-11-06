package pow

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"time"
)

// Proof is untrusted client evidence, not an admission or authentication factor.
// ParseProof permits bounded challenge lookup; only Verify authenticates it.
type Proof struct {
	ChallengeID string
	DerivedKey  [keySize]byte
}

func ParseProof(proof string) (Proof, error) {
	if len(proof) > MaxProofBytes {
		return Proof{}, ErrInvalidProof
	}
	obj, err := exactObject([]byte(proof), "protocol", "challenge_id", "derived_key")
	if err != nil {
		return Proof{}, ErrInvalidProof
	}
	protocol, ok := stringValue(obj["protocol"])
	if !ok || protocol != Protocol {
		return Proof{}, ErrInvalidProof
	}
	id, ok := stringValue(obj["challenge_id"])
	if !ok || !validBindingString(id) {
		return Proof{}, ErrInvalidProof
	}
	keyString, ok := stringValue(obj["derived_key"])
	if !ok {
		return Proof{}, ErrInvalidProof
	}
	key, ok := lowerHex(keyString, keySize)
	if !ok {
		return Proof{}, ErrInvalidProof
	}
	return Proof{ChallengeID: id, DerivedKey: [keySize]byte(key)}, nil
}

// Verify uses only bounded decoding and HMACs. A successful return is necessary
// but insufficient for admission: it does not consume the challenge. The expected
// binding and project keys must come from the caller's trusted state.
func Verify(stored StoredChallenge, proof string, expected Binding, keys Keys, now time.Time) error {
	parsed, err := ParseProof(proof)
	if err != nil {
		return err
	}
	defer clear(parsed.DerivedKey[:])
	if err := expected.validate(); err != nil {
		return err
	}
	if _, err := LookupProfile(expected.ProfileID); err != nil {
		return err
	}
	if err := keys.validate(); err != nil {
		return err
	}
	if len(stored.Body) > MaxChallengeBytes {
		return ErrInvalidChallenge
	}
	body, err := exactObject(stored.Body, "context", "key_prefix", "key_mac")
	if err != nil {
		return ErrInvalidChallenge
	}
	_, err = exactObject(body["context"], "protocol", "profile_id", "project_id", "operation",
		"operation_instance_id", "challenge_id", "expires_at", "salt", "nonce")
	if err != nil {
		return ErrInvalidChallenge
	}
	// Exact member validation precedes typed decoding so Go's case-insensitive
	// field matching and duplicate/null handling cannot weaken the binding.
	var ctx challengeContext
	if err := json.Unmarshal(body["context"], &ctx); err != nil || ctx.Protocol != Protocol {
		return ErrInvalidChallenge
	}
	if _, ok := lowerHex(ctx.Salt, saltSize); !ok {
		return ErrInvalidChallenge
	}
	if _, ok := lowerHex(ctx.Nonce, nonceSize); !ok {
		return ErrInvalidChallenge
	}
	if ctx.Binding != expected {
		return ErrBindingMismatch
	}
	if parsed.ChallengeID != expected.ChallengeID {
		return ErrInvalidProof
	}
	if expected.ExpiresAt <= now.Unix() {
		return ErrExpired
	}
	prefixString, prefixOK := stringValue(body["key_prefix"])
	prefix, prefixHexOK := lowerHex(prefixString, prefixSize)
	macString, macOK := stringValue(body["key_mac"])
	keyMAC, macHexOK := lowerHex(macString, sha256.Size)
	if !prefixOK || !prefixHexOK || !macOK || !macHexOK {
		return ErrInvalidChallenge
	}
	macMatches := hmac.Equal(keyMAC, authenticate(keys.Solution[:], solutionDomain, body["context"], parsed.DerivedKey[:]))
	prefixMatches := subtle.ConstantTimeCompare(prefix, parsed.DerivedKey[:prefixSize])
	if !macMatches || prefixMatches != 1 {
		return ErrInvalidProof
	}
	return nil
}
