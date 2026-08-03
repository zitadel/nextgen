package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureBrandingService(t *testing.T) *service.BrandingService {
	t.Helper()
	h.brandingService.mutex.Lock()
	defer h.brandingService.mutex.Unlock()

	if h.brandingService.value == nil {
		h.brandingService.value = service.NewBrandingService(
			h.EnsureServiceDB(t),
		)
	}
	return h.brandingService.value
}
