//go:build integration

package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureAuthAttemptService(t *testing.T) service.AuthAttemptService {
	t.Helper()
	if h.AuthAttemptService == nil {
		h.AuthAttemptService = service.NewAuthAttemptService(
			h.EnsureDBPool(t),
			h.EnsureAuthAttemptRepo(t),
			h.EnsureSessionRepo(t),
			h.EnsureProjectRepo(t),
			h.EnsureUserRepo(t),
			h.EnsureUserPasswordRepo(t),
			h.EnsureUserPasskeyRepo(t),
			h.EnsurePasswap(t),
		)
	}
	return h.AuthAttemptService
}

func (h *Harness) EnsureAuthAttemptRepo(t *testing.T) domain.AuthAttemptRepository {
	t.Helper()
	if h.AuthAttemptRepo == nil {
		h.AuthAttemptRepo = repository.NewAuthAttemptRepository(
			h.EnsureDBPool(t),
		)
	}
	return h.AuthAttemptRepo
}
