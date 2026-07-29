package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureProjectService(t *testing.T) service.ProjectService {
	t.Helper()
	h.projectService.mutex.Lock()
	defer h.projectService.mutex.Unlock()

	if h.projectService.value == nil {
		h.projectService.value = service.NewProjectService(
			h.EnsureServiceDB(t),
			BuiltinSchemaBaseURL,
			h.EnsureSchemaValidator(t),
			h.EnsureKeyService(t),
		)
	}
	return h.projectService.value
}
