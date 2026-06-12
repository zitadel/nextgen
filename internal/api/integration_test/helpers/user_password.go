package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureUserPasswordRepo(t *testing.T) domain.UserPasswordRepository {
	t.Helper()
	h.mu.Lock()
	repo := h.UserPasswordRepo
	h.mu.Unlock()
	if repo != nil {
		return repo
	}
	repo = repository.NewUserPasswordRepository()
	h.mu.Lock()
	if h.UserPasswordRepo == nil {
		h.UserPasswordRepo = repo
	}
	repo = h.UserPasswordRepo
	h.mu.Unlock()
	return repo
}
