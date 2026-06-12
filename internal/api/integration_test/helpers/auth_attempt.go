package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureAuthAttemptService(t *testing.T) service.AuthAttemptService {
	t.Helper()
	h.mu.Lock()
	svc := h.AuthAttemptService
	h.mu.Unlock()
	if svc != nil {
		return svc
	}
	svc = service.NewAuthAttemptService(
		h.EnsureDBPool(t),
		h.EnsureAuthAttemptRepo(t),
		h.EnsureSessionRepo(t),
		h.EnsureProjectRepo(t),
		h.EnsureUserRepo(t),
		h.EnsureUserPasswordRepo(t),
		h.EnsureUserPasskeyRepo(t),
		h.EnsureHashVerifier(t),
	)
	h.mu.Lock()
	if h.AuthAttemptService == nil {
		h.AuthAttemptService = svc
	}
	svc = h.AuthAttemptService
	h.mu.Unlock()
	return svc
}

func (h *Harness) EnsureAuthAttemptRepo(t *testing.T) domain.AuthAttemptRepository {
	t.Helper()
	h.mu.Lock()
	repo := h.AuthAttemptRepo
	h.mu.Unlock()
	if repo != nil {
		return repo
	}
	repo = repository.NewAuthAttemptRepository(
		h.EnsureDBPool(t),
	)
	h.mu.Lock()
	if h.AuthAttemptRepo == nil {
		h.AuthAttemptRepo = repo
	}
	repo = h.AuthAttemptRepo
	h.mu.Unlock()
	return repo
}
