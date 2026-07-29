package helpers

import (
	"crypto/rand"
	"crypto/rsa"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
)

func (h *Harness) EnsureSigningKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	h.signingKey.mutex.Lock()
	defer h.signingKey.mutex.Unlock()

	if h.signingKey.value == nil {
		signingKey, err := rsa.GenerateKey(rand.Reader, 2048)
		require.NoError(t, err)
		h.signingKey.value = signingKey
	}
	return h.signingKey.value
}

func (h *Harness) EnsureHasher(t *testing.T) crypto.Hasher {
	t.Helper()
	return h.ensureHasher(t)
}

func (h *Harness) EnsureHashVerifier(t *testing.T) crypto.HashVerifier {
	t.Helper()
	return h.ensureHasher(t)
}

func (h *Harness) EnsureHashValidator(t *testing.T) crypto.HashValidator {
	t.Helper()
	return h.ensureHasher(t)
}

func (h *Harness) ensureHasher(t *testing.T) *crypto.PasswapHasher {
	t.Helper()
	h.hasher.mutex.Lock()
	defer h.hasher.mutex.Unlock()

	if h.hasher.value == nil {
		h.hasher.value = createNewHasher(t)
	}
	return h.hasher.value
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

func (h *Harness) EnsureMasterKey(t *testing.T) *domain.MasterKeys {
	t.Helper()
	h.masterKeys.mutex.Lock()
	defer h.masterKeys.mutex.Unlock()

	if h.masterKeys.value == nil {
		key, err := rsa.GenerateKey(rand.Reader, 4096)
		require.NoError(t, err)
		h.masterKeys.value, err = domain.NewMasterKeys([]domain.MasterKey{
			domain.NewMasterKey(
				"master-key",
				*key,
				true,
			),
		})
		require.NoError(t, err)
	}
	return h.masterKeys.value
}
