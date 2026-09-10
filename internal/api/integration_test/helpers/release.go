package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureReleaseService(t *testing.T) service.ReleaseService {
	t.Helper()
	h.releaseService.mutex.Lock()
	defer h.releaseService.mutex.Unlock()

	if h.releaseService.value == nil {
		h.releaseService.value = service.NewReleaseService(
			h.EnsureServiceDB(t),
		)
	}
	return h.releaseService.value
}
