package crypto

//go:generate go tool mockgen -typed -package cryptomock -destination ./mock/encryption.mock.go . Encrypter,Decrypter,Crypter

type Encrypter interface {
	Encrypt(string) (string, error)
}
type Decrypter interface {
	Decrypt(string) (string, error)
}

type Crypter interface {
	Encrypter
	Decrypter
}
