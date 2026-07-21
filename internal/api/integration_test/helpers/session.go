package helpers

import (
	"testing"
	"time"

	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureSessionService(t *testing.T) service.SessionService {
	t.Helper()
	if h.SessionService == nil {
		h.SessionService = service.NewSessionService(
			h.EnsureDBPool(t),
			h.ServiceDB(t),
			repository.NewUserRepository(),
			service.SessionConfig{DefaultTTL: time.Hour, MaxTTL: 24 * time.Hour},
		)
	}
	return h.SessionService
}
