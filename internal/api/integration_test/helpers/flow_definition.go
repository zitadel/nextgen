package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureFlowDefinitionService(t *testing.T) service.FlowDefinitionService {
	t.Helper()
	h.mu.Lock()
	svc := h.FlowDefinitionService
	h.mu.Unlock()
	if svc != nil {
		return svc
	}
	svc = service.NewFlowDefinitionService(
		h.EnsureDBPool(t),
		h.EnsureSchemaService(t),
		h.EnsureSchemaValidator(t),
		nil,
		h.EnsureFlowDefinitionRepo(t),
	)
	h.mu.Lock()
	if h.FlowDefinitionService == nil {
		h.FlowDefinitionService = svc
	}
	svc = h.FlowDefinitionService
	h.mu.Unlock()
	return svc
}
