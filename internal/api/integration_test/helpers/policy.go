package helpers

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/policy"
	"github.com/zitadel/nextgen/internal/service"
)

// EnsurePolicyService mirrors the server wiring: the embedded catalog over
// the harness database, which is also the resolver the password gate reads.
func (h *Harness) EnsurePolicyService(t *testing.T) *service.PolicyService {
	t.Helper()
	h.policyService.mutex.Lock()
	defer h.policyService.mutex.Unlock()

	if h.policyService.value == nil {
		engine, err := policy.New()
		require.NoError(t, err)
		h.policyService.value = service.NewPolicyService(h.EnsureServiceDB(t), engine)
	}
	return h.policyService.value
}

// EnsurePasswordPolicy is the `user.password.save` gate over the policy
// service.
func (h *Harness) EnsurePasswordPolicy(t *testing.T) *service.PasswordPolicy {
	t.Helper()
	h.passwordPolicy.mutex.Lock()
	defer h.passwordPolicy.mutex.Unlock()

	if h.passwordPolicy.value == nil {
		svc := h.EnsurePolicyService(t)
		h.passwordPolicy.value = service.NewPasswordPolicy(svc.Engine(), svc, h.EnsureHashVerifier(t))
	}
	return h.passwordPolicy.value
}
