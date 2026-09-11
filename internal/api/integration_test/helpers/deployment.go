package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureDeploymentService(t *testing.T) *service.DeploymentService {
	t.Helper()
	h.deploymentService.mutex.Lock()
	defer h.deploymentService.mutex.Unlock()

	if h.deploymentService.value == nil {
		h.deploymentService.value = service.NewDeploymentService(
			h.EnsureServiceDB(t),
		)
	}
	return h.deploymentService.value
}
