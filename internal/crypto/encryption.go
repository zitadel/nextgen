package crypto

import (
	"context"

	"github.com/go-jose/go-jose/v4"
	"github.com/zitadel/oidc/v3/pkg/op"
)

type DecrypterFactory = func(ctx context.Context, keyID string, algorithm jose.ContentEncryption) (op.Decrypter, error)

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

type DecrypterFn func(string) (string, error)

func (f DecrypterFn) Decrypt(encrypted string) (string, error) { return f(encrypted) }
