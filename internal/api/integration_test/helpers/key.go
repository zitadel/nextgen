package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureKeyService(t *testing.T) service.KeyService {
	t.Helper()
	h.keyService.mutex.Lock()
	defer h.keyService.mutex.Unlock()

	if h.keyService.value == nil {
		h.keyService.value = service.NewKeyService(
			h.EnsureServiceDB(t),
			*(h.EnsureMasterKey(t)),
		)
	}
	return h.keyService.value
}
