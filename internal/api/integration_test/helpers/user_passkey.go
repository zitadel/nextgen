package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureUserPasskeyRepo(t *testing.T) domain.UserPasskeyRepository {
	t.Helper()
	h.userPasskeyRepo.mutex.Lock()
	defer h.userPasskeyRepo.mutex.Unlock()

	if h.userPasskeyRepo.value == nil {
		h.userPasskeyRepo.value = repository.NewUserPasskeyRepository()
	}

	return h.userPasskeyRepo.value
}
