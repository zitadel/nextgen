package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func (h *Harness) EnsureBrandingRepo(t *testing.T) domain.BrandingRepository {
	t.Helper()
	if h.BrandingRepo == nil {
		h.BrandingRepo = repository.NewBrandingRepository(
			h.EnsureDBPool(t),
		)
	}
	return h.BrandingRepo
}

func (h *Harness) EnsureBrandingService(t *testing.T) *service.BrandingService {
	t.Helper()
	if h.BrandingService == nil {
		h.BrandingService = service.NewBrandingService(
			h.EnsureDBPool(t),
			h.EnsureBrandingRepo(t),
		)
	}
	return h.BrandingService
}
