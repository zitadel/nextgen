package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureUserRepo(t *testing.T) domain.UserRepository {
	t.Helper()
	if h.UserRepo == nil {
		h.UserRepo = repository.NewUserRepository()
	}

	return h.UserRepo
}
