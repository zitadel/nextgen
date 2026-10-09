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
			h.EnsureServiceDB(t),
			service.SessionStatementsResolver{Pool: h.EnsureServiceDB(t)},
			service.UserStatementsLookup{Pool: h.EnsureServiceDB(t)},
			h.EnsureHashVerifier(t),
		)
	}
	return h.authAttemptService.value
}
