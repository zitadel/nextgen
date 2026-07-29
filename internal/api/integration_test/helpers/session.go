package helpers

import (
	"testing"
	"time"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureSessionService(t *testing.T) service.SessionService {
	t.Helper()
	h.sessionService.mutex.Lock()
	defer h.sessionService.mutex.Unlock()

	if h.sessionService.value == nil {
		h.sessionService.value = service.NewSessionService(
			h.EnsureServiceDB(t),
			service.UserStatementsIdentityReader{Pool: h.EnsureServiceDB(t)},
			service.SessionConfig{DefaultTTL: time.Hour, MaxTTL: 24 * time.Hour},
		)
	}
	return h.sessionService.value
}
