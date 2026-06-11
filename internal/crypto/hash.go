package crypto

//go:generate go tool mockgen -typed -package cryptomock -destination ./cryptomock/hash.mock.go . Hasher

type Hasher interface {
	Hash(string) (string, error)
}

type HashVerifier interface {
	VerifyHash(encoded string, target string) error
}

type HashValidator interface {
	ValidateHash(encoded string) error
}
