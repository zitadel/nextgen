package crypto

type Hasher interface {
	Hash(string) (string, error)
}

type HashVerifier interface {
	VerifyHash(encoded string, target string) error
}

type HashValidator interface {
	ValidateHash(encoded string) error
}
