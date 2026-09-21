package helpers

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/policy"
	"github.com/zitadel/nextgen/internal/service"
)

// EnsurePasswordPolicy mirrors the server wiring: the embedded catalog with
// no instance resolver, so every project runs on the template defaults.
func (h *Harness) EnsurePasswordPolicy(t *testing.T) *service.PasswordPolicy {
	t.Helper()
	h.passwordPolicy.mutex.Lock()
	defer h.passwordPolicy.mutex.Unlock()

	if h.passwordPolicy.value == nil {
		engine, err := policy.New()
		require.NoError(t, err)
		h.passwordPolicy.value = service.NewPasswordPolicy(engine, nil, h.EnsureHashVerifier(t))
	}
	return h.passwordPolicy.value
}
