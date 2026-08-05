package crypto

//go:generate go tool mockgen -typed -package cryptomock -destination ./mock/hash.mock.go . Hasher,HashVerifier,HashValidator

type Hasher interface {
	Hash(string) (string, error)
}

type HashVerifier interface {
	VerifyHash(encoded string, target string) error
}

type HashValidator interface {
	ValidateHash(encoded string) error
}
