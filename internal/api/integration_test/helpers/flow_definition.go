package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureFlowDefinitionService(t *testing.T) service.FlowDefinitionService {
	t.Helper()
	if h.FlowDefinitionService == nil {
		h.FlowDefinitionService = service.NewFlowDefinitionService(
			h.EnsureDBPool(t),
			h.EnsureSchemaService(t),
			h.EnsureSchemaValidator(t),
			nil,
			h.EnsureFlowDefinitionRepo(t),
		)
	}
	return h.FlowDefinitionService
}
