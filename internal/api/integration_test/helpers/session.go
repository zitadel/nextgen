package helpers

import (
	"testing"
	"time"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureSessionService(t *testing.T) service.SessionService {
	t.Helper()
	if h.SessionService == nil {
		h.SessionService = service.NewSessionService(
			h.EnsureServiceDB(t),
			service.UserStatementsIdentityReader{Pool: h.EnsureServiceDB(t)},
			service.SessionConfig{DefaultTTL: time.Hour, MaxTTL: 24 * time.Hour},
		)
	}
	return h.SessionService
}
