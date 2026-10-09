package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureTokenService(t *testing.T) service.TokenService {
	t.Helper()
	h.tokenService.mutex.Lock()
	defer h.tokenService.mutex.Unlock()

	if h.tokenService.value == nil {
		h.tokenService.value = service.NewTokenService(
			h.EnsureKeyService(t),
			h.EnsureServiceDB(t),
		)
	}
	return h.tokenService.value
}
