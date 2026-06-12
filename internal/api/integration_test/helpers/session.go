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
	h.mu.Lock()
	svc := h.SessionService
	h.mu.Unlock()
	if svc != nil {
		return svc
	}
	svc = service.NewSessionService(
		h.EnsureDBPool(t),
		h.EnsureSessionRepo(t),
		service.SessionConfig{DefaultTTL: time.Hour, MaxTTL: 24 * time.Hour},
	)
	h.mu.Lock()
	if h.SessionService == nil {
		h.SessionService = svc
	}
	svc = h.SessionService
	h.mu.Unlock()
	return svc
}

func (h *Harness) EnsureSessionRepo(t *testing.T) domain.SessionRepository {
	t.Helper()
	h.mu.Lock()
	repo := h.SessionRepo
	h.mu.Unlock()
	if repo != nil {
		return repo
	}
	repo = repository.NewSessionRepository(
		h.EnsureDBPool(t),
	)
	h.mu.Lock()
	if h.SessionRepo == nil {
		h.SessionRepo = repo
	}
	repo = h.SessionRepo
	h.mu.Unlock()
	return repo
}
