package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureUserService(t *testing.T) *service.UserService {
	t.Helper()
	if h.UserService == nil {
		h.UserService = service.NewUserService(
			h.EnsureDBPool(t),
			h.EnsureUserRepo(t),
			h.EnsureSchemaRepo(t),
			h.EnsureDecrypter(t),
		)
	}
	return h.UserService
}

func (h *Harness) EnsureUserRepo(t *testing.T) domain.UserRepository {
	t.Helper()
	if h.UserRepo == nil {
		h.UserRepo = repository.NewUserRepository()
	}

	return h.UserRepo
}
