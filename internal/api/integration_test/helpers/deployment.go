package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureRuntimeResolver(t *testing.T) *service.RuntimeResolver {
	t.Helper()
	h.runtimeResolver.mutex.Lock()
	defer h.runtimeResolver.mutex.Unlock()

	if h.runtimeResolver.value == nil {
		h.runtimeResolver.value = service.NewRuntimeResolver(h.EnsureServiceDB(t), h.EnsureReleaseService(t))
	}
	return h.runtimeResolver.value
}

func (h *Harness) EnsureDeploymentService(t *testing.T) *service.DeploymentService {
	t.Helper()
	h.deploymentService.mutex.Lock()
	defer h.deploymentService.mutex.Unlock()

	if h.deploymentService.value == nil {
		h.deploymentService.value = service.NewDeploymentService(
			h.EnsureServiceDB(t),
			h.EnsureReleaseService(t),
			service.NewVariableService(h.EnsureServiceDB(t), h.EnsureKeyService(t)),
		)
	}
	return h.deploymentService.value
}
