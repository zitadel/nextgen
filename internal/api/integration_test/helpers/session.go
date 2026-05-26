package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureSessionRepo(t *testing.T) domain.SessionRepository {
	t.Helper()
	if h.SessionRepo == nil {
		h.SessionRepo = repository.NewSessionRepository(
			h.EnsureDBPool(t),
		)
	}
	return h.SessionRepo
}
