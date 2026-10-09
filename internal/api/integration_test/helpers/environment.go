package helpers

import (
	"testing"

	"github.com/zitadel/zitadel/v5/internal/service"
)

func (h *Harness) EnsureEnvironmentService(t *testing.T) *service.EnvironmentService {
	t.Helper()
	h.environmentService.mutex.Lock()
	defer h.environmentService.mutex.Unlock()

	if h.environmentService.value == nil {
		h.environmentService.value = service.NewEnvironmentService(
			h.EnsureServiceDB(t),
		)
	}
	return h.environmentService.value
}
