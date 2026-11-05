package migratev4

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// The ledger keeps a digest of each migrated IdP client secret, to notice when
// the source or the target changed it. The ledger is readable by whoever can
// read the database, so the digest is a salted argon2id hash, never a fast
// one: reading it must not open an offline guess of a weak secret. An
// instance has a handful of IdPs, so the cost does not add up.
const (
	secretDigestPrefix  = "argon2id"
	secretDigestTime    = 2
	secretDigestMemory  = 19 * 1024
	secretDigestThreads = 1
	secretDigestLength  = 32
)

// secretDigest hashes secret under a fresh salt.
func secretDigest(secret string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("salt the secret digest: %w", err)
	}
	return encodeSecretDigest(salt, secret), nil
}

func encodeSecretDigest(salt []byte, secret string) string {
	sum := argon2.IDKey([]byte(secret), salt, secretDigestTime, secretDigestMemory, secretDigestThreads, secretDigestLength)
	return secretDigestPrefix + "$" + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(sum)
}

// secretMatches reports whether digest is secretDigest of secret. Anything
// that is not such a digest, an earlier ledger format included, never matches.
func secretMatches(digest, secret string) bool {
	prefix, rest, ok := strings.Cut(digest, "$")
	if !ok || prefix != secretDigestPrefix {
		return false
	}
	encodedSalt, _, ok := strings.Cut(rest, "$")
	if !ok {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(encodedSalt)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(encodeSecretDigest(salt, secret)), []byte(digest)) == 1
}

// secretUnchanged reports whether a secret mapping's fingerprint, the source
// ciphertext's fingerprint and the digest of what was written, still describes
// the source ciphertext sourceFP decrypting to secret.
func secretUnchanged(recorded, sourceFP, secret string) bool {
	source, digest, ok := strings.Cut(recorded, ".")
	return ok && source == sourceFP && secretMatches(digest, secret)
}

// stringValue is a variable's value as the string a secret is, "" for any
// other value, which no digest matches.
func stringValue(v any) string {
	s, _ := v.(string)
	return s
}
