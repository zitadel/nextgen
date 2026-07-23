package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureTokenService(t *testing.T) service.TokenService {
	t.Helper()
	if h.TokenService == nil {
		h.TokenService = service.NewTokenService(
			h.EnsureKeyService(t),
		)
	}
	return h.TokenService
}
