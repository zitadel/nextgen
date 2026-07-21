package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureAuthAttemptService(t *testing.T) service.AuthAttemptService {
	t.Helper()
	if h.AuthAttemptService == nil {
		h.AuthAttemptService = service.NewAuthAttemptService(
			h.EnsureDBPool(t),
			h.ServiceDB(t),
			service.SessionStatementsResolver{Pool: h.ServiceDB(t)},
			h.EnsureUserRepo(t),
			h.EnsureUserPasswordRepo(t),
			h.EnsureUserPasskeyRepo(t),
			h.EnsureHashVerifier(t),
		)
	}
	return h.AuthAttemptService
}
