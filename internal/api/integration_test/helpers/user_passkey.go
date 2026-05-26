package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureUserPasskeyRepo(t *testing.T) domain.UserPasskeyRepository {
	t.Helper()
	if h.UserPasskeyRepo == nil {
		h.UserPasskeyRepo = repository.NewUserPasskeyRepository()
	}

	return h.UserPasskeyRepo
}
