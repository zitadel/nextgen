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
		db := h.EnsureServiceDB(t)
		h.releaseService.value = service.NewReleaseService(
			db,
			h.EnsureSchemaService(t),
			service.NewFlowDefinitionService(db, h.EnsureSchemaValidator(t), nil, BuiltinSchemaBases()),
			h.EnsureBrandingService(t),
			service.NewIDPConnectionService(db, h.EnsureSchemaValidator(t)),
			h.EnsurePolicyService(t),
			BuiltinSchemaBases(),
		)
	}
	return h.releaseService.value
}
