package crypto

import "context"

// Hasher hashes a password. The context bounds the wait for a hashing slot, see
// [HashConcurrencyConfig]; the hash itself does not stop when it ends.
type Hasher interface {
	Hash(ctx context.Context, password string) (string, error)
}

// HashVerifier checks a password against an encoded hash. The context bounds
// the wait for a hashing slot, as for [Hasher].
type HashVerifier interface {
	VerifyHash(ctx context.Context, encoded string, target string) error
}

type HashValidator interface {
	ValidateHash(encoded string) error
}
