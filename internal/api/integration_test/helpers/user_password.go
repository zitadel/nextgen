package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureUserPasswordRepo(t *testing.T) domain.UserPasswordRepository {
	t.Helper()
	if h.UserPasswordRepo == nil {
		h.UserPasswordRepo = repository.NewUserPasswordRepository()
	}

	return h.UserPasswordRepo
}
