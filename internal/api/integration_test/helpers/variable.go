package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureVariableService(t *testing.T) service.VariableService {
	t.Helper()
	h.variableService.mutex.Lock()
	defer h.variableService.mutex.Unlock()

	if h.variableService.value == nil {
		h.variableService.value = service.NewVariableService(h.EnsureServiceDB(t), h.EnsureKeyService(t))
	}
	return h.variableService.value
}

func (h *Harness) EnsureVariableResolver(t *testing.T) service.VariableResolver {
	t.Helper()
	h.variableResolver.mutex.Lock()
	defer h.variableResolver.mutex.Unlock()

	if h.variableResolver.value == nil {
		h.variableResolver.value = service.NewVariableResolver(h.EnsureServiceDB(t), h.EnsureKeyService(t))
	}
	return h.variableResolver.value
}
