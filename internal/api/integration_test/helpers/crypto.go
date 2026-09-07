package helpers

import (
	"crypto/rand"
	"crypto/rsa"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
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
	return h.EnsureHasherFactory(t).Default()
}

// EnsureProjectHashers is the real per-project resolver over the harness pool,
// so a test that gives a project its own hashing method exercises the same
// resolution the server does.
func (h *Harness) EnsureProjectHashers(t *testing.T) service.ProjectHasherResolver {
	t.Helper()
	return service.NewProjectHasherResolver(h.EnsureServiceDB(t), h.EnsureHasherFactory(t))
}

func (h *Harness) EnsureHasherFactory(t *testing.T) *crypto.HasherFactory {
	t.Helper()
	h.hasherFactory.mutex.Lock()
	defer h.hasherFactory.mutex.Unlock()

	if h.hasherFactory.value == nil {
		h.hasherFactory.value = createNewHasherFactory(t)
	}
	return h.hasherFactory.value
}

func createNewHasherFactory(t *testing.T) *crypto.HasherFactory {
	// bcrypt hashes fast enough for a test suite and is the default here for
	// that reason. argon2 is configured too, but only as a verifier and a set of
	// limits: that is what a project needs to be allowed to choose it, and it is
	// what lets a test tell a project's own method apart from the deployment's
	// by the prefix of what comes out.
	cfg := crypto.HashConfig{
		Verifiers: []crypto.HashName{crypto.HashNameBcrypt, crypto.HashNameArgon2},
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
			Argon2: crypto.Argon2LimitsConfig{
				MinTime: 1, MaxTime: 8,
				MinMemory: 8 * 1024, MaxMemory: 128 * 1024,
				MinThreads: 1, MaxThreads: 8,
			},
		},
	}
	factory, err := cfg.NewHasherFactory()
	require.NoError(t, err)
	return factory
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
