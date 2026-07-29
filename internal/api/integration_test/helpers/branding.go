package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureBrandingService(t *testing.T) *service.BrandingService {
	t.Helper()
	if h.BrandingService == nil {
		h.BrandingService = service.NewBrandingService(
			h.EnsureServiceDB(t),
		)
	}
	return h.BrandingService
}
