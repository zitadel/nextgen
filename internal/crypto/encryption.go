package crypto

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
