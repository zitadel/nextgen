package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureAuthAttemptService(t *testing.T) service.AuthAttemptService {
	t.Helper()
	h.authAttemptService.mutex.Lock()
	defer h.authAttemptService.mutex.Unlock()

	if h.authAttemptService.value == nil {
		h.authAttemptService.value = service.NewAuthAttemptService(
			h.EnsureDBPool(t),
			h.EnsureServiceDB(t),
			service.SessionStatementsResolver{Pool: h.EnsureServiceDB(t)},
			h.EnsureUserRepo(t),
			h.EnsureUserPasswordRepo(t),
			h.EnsureUserPasskeyRepo(t),
			h.EnsureHashVerifier(t),
		)
	}
	return h.authAttemptService.value
}
