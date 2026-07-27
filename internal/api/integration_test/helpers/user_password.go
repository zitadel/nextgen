package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureUserPasswordRepo(t *testing.T) domain.UserPasswordRepository {
	t.Helper()
	h.userPasswordRepo.mutex.Lock()
	defer h.userPasswordRepo.mutex.Unlock()

	if h.userPasswordRepo.value == nil {
		h.userPasswordRepo.value = repository.NewUserPasswordRepository()
	}

	return h.userPasswordRepo.value
}
