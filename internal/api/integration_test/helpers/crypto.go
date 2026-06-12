package helpers

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/oidc/v3/pkg/op"
)

func (h *Harness) EnsureHasher(t *testing.T) crypto.Hasher {
	t.Helper()
	return h.ensurePasswapHasher(t)
}

func (h *Harness) EnsureHashVerifier(t *testing.T) crypto.HashVerifier {
	t.Helper()
	return h.ensurePasswapHasher(t)
}

func (h *Harness) EnsureHashValidator(t *testing.T) crypto.HashValidator {
	t.Helper()
	return h.ensurePasswapHasher(t)
}

func (h *Harness) ensurePasswapHasher(t *testing.T) *crypto.PasswapHasher {
	t.Helper()
	h.mu.Lock()
	hasher := h.Hasher
	h.mu.Unlock()
	if hasher != nil {
		return hasher
	}
	hasher = createNewHasher(t)
	h.mu.Lock()
	if h.Hasher == nil {
		h.Hasher = hasher
	}
	hasher = h.Hasher
	h.mu.Unlock()
	return hasher
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
	h.mu.Lock()
	crypter := h.Crypter
	h.mu.Unlock()
	if crypter != nil {
		return crypter
	}
	key := [32]byte([]byte("MasterkeyNeedsToHave32Characters"))
	crypter = op.NewAES256GCMCrypto(key, "")
	h.mu.Lock()
	if h.Crypter == nil {
		h.Crypter = crypter
	}
	crypter = h.Crypter
	h.mu.Unlock()
	return crypter
}

func (h *Harness) EnsureEncrypter(t *testing.T) crypto.Encrypter {
	return h.EnsureCrypter(t)
}
func (h *Harness) EnsureDecrypter(t *testing.T) crypto.Decrypter {
	return h.EnsureCrypter(t)
}
