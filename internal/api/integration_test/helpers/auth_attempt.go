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
			h.EnsureServiceDB(t),
			service.SessionStatementsResolver{Pool: h.EnsureServiceDB(t)},
			service.UserStatementsLookup{Pool: h.EnsureServiceDB(t)},
			h.EnsureUserPasskeyRepo(t),
			h.EnsureHashVerifier(t),
		)
	}
	return h.AuthAttemptService
}
