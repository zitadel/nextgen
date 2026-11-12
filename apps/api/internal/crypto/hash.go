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

// RehashingVerifier verifies a password and returns a new hash when the stored
// one is outdated. See [PasswapHasher.VerifyAndRehash]. The context bounds the
// wait for a hashing slot, as for [Hasher].
type RehashingVerifier interface {
	VerifyAndRehash(ctx context.Context, encoded string, target string) (updated string, err error)
}

// PasswordHasher writes new hashes and moves outdated ones to its own method.
type PasswordHasher interface {
	Hasher
	RehashingVerifier
}

type HashValidator interface {
	ValidateHash(encoded string) error
}
