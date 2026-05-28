package helpers

import (
	"testing"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureSessionService(t *testing.T) service.SessionService {
	t.Helper()
	if h.SessionService == nil {
		h.SessionService = service.NewSessionService(
			h.EnsureDBPool(t),
			h.EnsureSessionRepo(t),
			service.SessionConfig{DefaultTTL: time.Hour, MaxTTL: 24 * time.Hour},
		)
	}
	return h.SessionService
}

func (h *Harness) EnsureSessionRepo(t *testing.T) domain.SessionRepository {
	t.Helper()
	if h.SessionRepo == nil {
		h.SessionRepo = repository.NewSessionRepository(
			h.EnsureDBPool(t),
		)
	}
	return h.SessionRepo
}
