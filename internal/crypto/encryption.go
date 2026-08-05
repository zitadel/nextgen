package crypto

import (
	"context"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/oidc/v3/pkg/op"
)

//go:generate go tool mockgen -typed -package cryptomock -destination ./mock/encryption.mock.go . Encrypter,Decrypter,Crypter

type DecrypterFunc = func(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (op.Decrypter, error)

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
