package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureReleaseService(t testing.TB) service.ReleaseService {
	t.Helper()
	h.releaseService.mutex.Lock()
	defer h.releaseService.mutex.Unlock()

	if h.releaseService.value == nil {
		h.releaseService.value = service.NewReleaseService(
			h.EnsureServiceDB(t),
			BuiltinSchemaBases(),
		)
	}
	return h.releaseService.value
}
