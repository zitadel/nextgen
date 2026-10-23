package helpers

import (
	"crypto/rand"
	"crypto/rsa"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/policy"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureSigningKey(t testing.TB) *rsa.PrivateKey {
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

func (h *Harness) EnsureHasher(t testing.TB) crypto.Hasher {
	t.Helper()
	return h.ensureHasher(t)
}

func (h *Harness) EnsureHashVerifier(t testing.TB) crypto.HashVerifier {
	t.Helper()
	return h.ensureHasher(t)
}

func (h *Harness) EnsureHashValidator(t testing.TB) crypto.HashValidator {
	t.Helper()
	return h.ensureHasher(t)
}

func (h *Harness) ensureHasher(t testing.TB) *crypto.PasswapHasher {
	t.Helper()
	return h.EnsureHasherFactory(t).Default()
}

func (h *Harness) EnsureProjectHashers(t testing.TB) service.ProjectHasherResolver {
	t.Helper()
	return service.NewProjectHasherResolver(h.EnsureServiceDB(t), h.EnsureHasherFactory(t))
}

// EnsurePolicyService is the operation policy service the server wires: the
// embedded policy catalog over the harness database.
func (h *Harness) EnsurePolicyService(t testing.TB) *service.PolicyService {
	t.Helper()
	db := h.EnsureServiceDB(t)
	h.policyService.mutex.Lock()
	defer h.policyService.mutex.Unlock()

	if h.policyService.value == nil {
		engine, err := policy.New()
		require.NoError(t, err)
		h.policyService.value = service.NewPolicyService(db, engine)
	}
	return h.policyService.value
}

// EnsurePasswordPolicy is the password gate the server wires: the embedded
// policy catalog, the project's published instance resolved through the
// policy service, and the deployment's default verifier for history checks.
func (h *Harness) EnsurePasswordPolicy(t testing.TB) *service.PasswordPolicy {
	t.Helper()
	hasherFactory := h.EnsureHasherFactory(t)
	db := h.EnsureServiceDB(t)
	policies := h.EnsurePolicyService(t)
	h.passwordPolicy.mutex.Lock()
	defer h.passwordPolicy.mutex.Unlock()

	if h.passwordPolicy.value == nil {
		engine, err := policy.New()
		require.NoError(t, err)
		h.passwordPolicy.value, err = service.NewPasswordPolicy(engine, policies, hasherFactory.Default(), db)
		require.NoError(t, err)
	}
	return h.passwordPolicy.value
}

func (h *Harness) EnsureHasherFactory(t testing.TB) *crypto.HasherFactory {
	t.Helper()
	h.hasherFactory.mutex.Lock()
	defer h.hasherFactory.mutex.Unlock()

	if h.hasherFactory.value == nil {
		h.hasherFactory.value = createNewHasherFactory(t)
	}
	return h.hasherFactory.value
}

func createNewHasherFactory(t testing.TB) *crypto.HasherFactory {
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

func (h *Harness) EnsureMasterKey(t testing.TB) *domain.MasterKeys {
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
