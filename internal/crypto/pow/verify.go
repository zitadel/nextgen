package pow

import (
	"bytes"
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
// but insufficient for admission: it does not consume the requirement. All state,
// key eligibility and profile availability must come from authoritative storage.
func Verify(stored StoredChallenge, proof string, expected Binding, keys Keys, availability Availability, now time.Time) error {
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
	if availability != Enabled && availability != VerifyOnly {
		return ErrUnavailableProfile
	}
	if err := keys.validate(); err != nil {
		return err
	}
	if len(stored.Body) > MaxChallengeBytes || len(stored.MAC) != sha256.Size ||
		!hmac.Equal(stored.MAC, authenticate(keys.Challenge[:], parametersDomain, stored.Body)) {
		return ErrInvalidChallenge
	}
	body, err := exactObject(stored.Body, "context", "key_prefix", "key_mac")
	if err != nil {
		return ErrInvalidChallenge
	}
	ctx, err := exactObject(body["context"], "protocol", "profile_id", "project_id", "deployment_id",
		"release_id", "policy_revision", "config_revision", "attempt_id", "operation",
		"operation_instance_id", "requirement_id", "challenge_id", "generation",
		"challenge_key_version", "solution_key_version", "expires_at", "salt", "nonce")
	if err != nil {
		return ErrInvalidChallenge
	}
	// Compare every field against the authoritative binding. Comparing normalized
	// primitive JSON also rejects nulls, wrong types and non-integer number syntax;
	// no client or stored field is allowed to overwrite an expected binding.
	salt, saltOK := stringValue(ctx["salt"])
	nonce, nonceOK := stringValue(ctx["nonce"])
	if _, ok := lowerHex(salt, saltSize); !ok || !saltOK {
		return ErrInvalidChallenge
	}
	if _, ok := lowerHex(nonce, nonceSize); !ok || !nonceOK {
		return ErrInvalidChallenge
	}
	expectedJSON, err := json.Marshal(expected.context(salt, nonce))
	if err != nil {
		return ErrInvalidBinding
	}
	var expectedFields map[string]json.RawMessage
	if err := json.Unmarshal(expectedJSON, &expectedFields); err != nil {
		return ErrInvalidBinding
	}
	for name, want := range expectedFields {
		// String escapes/order need not be canonical. The MAC always covers the
		// original bytes, while binding equality compares decoded string values.
		if len(want) > 0 && want[0] == '"' {
			got, ok := stringValue(ctx[name])
			wantString, _ := stringValue(want)
			if !ok || got != wantString {
				return ErrBindingMismatch
			}
		} else if !bytes.Equal(ctx[name], want) {
			return ErrBindingMismatch
		}
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
