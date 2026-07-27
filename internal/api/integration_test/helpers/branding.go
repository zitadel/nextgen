package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureBrandingRepo(t *testing.T) domain.BrandingRepository {
	t.Helper()
	h.brandingRepo.mutex.Lock()
	defer h.brandingRepo.mutex.Unlock()

	if h.brandingRepo.value == nil {
		h.brandingRepo.value = repository.NewBrandingRepository(
			h.EnsureDBPool(t),
		)
	}
	return h.brandingRepo.value
}

func (h *Harness) EnsureBrandingService(t *testing.T) *service.BrandingService {
	t.Helper()
	h.brandingService.mutex.Lock()
	defer h.brandingService.mutex.Unlock()

	if h.brandingService.value == nil {
		h.brandingService.value = service.NewBrandingService(
			h.EnsureDBPool(t),
			h.EnsureBrandingRepo(t),
		)
	}
	return h.brandingService.value
}
