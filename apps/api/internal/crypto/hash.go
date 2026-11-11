package crypto

type Hasher interface {
	Hash(string) (string, error)
}

type HashVerifier interface {
	VerifyHash(encoded string, target string) error
}

// RehashingVerifier verifies a password and returns a new hash when the stored
// one is outdated. See [PasswapHasher.VerifyAndRehash].
type RehashingVerifier interface {
	VerifyAndRehash(encoded string, target string) (updated string, err error)
}

// PasswordHasher writes new hashes and moves outdated ones to its own method.
type PasswordHasher interface {
	Hasher
	RehashingVerifier
}

type HashValidator interface {
	ValidateHash(encoded string) error
}
