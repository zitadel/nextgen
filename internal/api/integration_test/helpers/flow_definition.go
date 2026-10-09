package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureFlowDefinitionService(t *testing.T) service.FlowDefinitionService {
	t.Helper()
	h.flowDefinitionService.mutex.Lock()
	defer h.flowDefinitionService.mutex.Unlock()

	if h.flowDefinitionService.value == nil {
		h.flowDefinitionService.value = service.NewFlowDefinitionService(
			h.EnsureServiceDB(t),
			h.EnsureSchemaService(t),
			h.EnsureSchemaValidator(t),
			nil,
		)
	}
	return h.flowDefinitionService.value
}
