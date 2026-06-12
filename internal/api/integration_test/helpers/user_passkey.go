package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureUserPasskeyRepo(t *testing.T) domain.UserPasskeyRepository {
	t.Helper()
	h.mu.Lock()
	repo := h.UserPasskeyRepo
	h.mu.Unlock()
	if repo != nil {
		return repo
	}
	repo = repository.NewUserPasskeyRepository()
	h.mu.Lock()
	if h.UserPasskeyRepo == nil {
		h.UserPasskeyRepo = repo
	}
	repo = h.UserPasskeyRepo
	h.mu.Unlock()
	return repo
}
