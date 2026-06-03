package helpers

import (
	"crypto/rand"
	"crypto/rsa"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/oidc/v3/pkg/op"
)

func (h *Harness) EnsureEncryptionKey(t *testing.T) [32]byte {
	t.Helper()
	if h.EncryptionKey == nil {
		h.EncryptionKey = []byte("MasterkeyNeedsToHave32Characters")
	}
	return [32]byte(h.EncryptionKey)
}

func (h *Harness) EnsureSigningKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	if h.SigningKey == nil {
		signingKey, err := rsa.GenerateKey(rand.Reader, 2048)
		require.NoError(t, err)
		h.SigningKey = signingKey
	}
	return h.SigningKey
}

func (h *Harness) EnsureHasher(t *testing.T) crypto.Hasher {
	t.Helper()
	if h.Hasher == nil {
		h.Hasher = createNewHasher(t)
	}
	return h.Hasher
}

func (h *Harness) EnsureHashVerifier(t *testing.T) crypto.HashVerifier {
	t.Helper()
	if h.Hasher == nil {
		h.Hasher = createNewHasher(t)
	}
	return h.Hasher
}

func (h *Harness) EnsureHashValidator(t *testing.T) crypto.HashValidator {
	t.Helper()
	if h.Hasher == nil {
		h.Hasher = createNewHasher(t)
	}
	return h.Hasher
}

func createNewHasher(t *testing.T) *crypto.PasswapHasher {
	cfg := crypto.HashConfig{
		Verifiers: []crypto.HashName{crypto.HashNameBcrypt},
		Hasher: crypto.HasherConfig{
			Algorithm: crypto.HashNameBcrypt,
			Params: map[string]any{
				"cost": 10,
			},
		},
		Limits: crypto.HashLimitsConfig{
			Bcrypt: crypto.BcryptLimitsConfig{
				MinCost: 10,
				MaxCost: 16,
			},
		},
	}
	hasher, err := cfg.NewHasher()
	require.NoError(t, err)
	return hasher
}

func (h *Harness) EnsureCrypter(t *testing.T) crypto.Crypter {
	t.Helper()
	if h.Crypter == nil {
		h.Crypter = op.NewAES256GCMCrypto(
			h.EnsureEncryptionKey(t),
			"",
		)
	}
	return h.Crypter
}

func (h *Harness) EnsureEncrypter(t *testing.T) crypto.Encrypter {
	return h.EnsureCrypter(t)
}
func (h *Harness) EnsureDecrypter(t *testing.T) crypto.Decrypter {
	return h.EnsureCrypter(t)
}
