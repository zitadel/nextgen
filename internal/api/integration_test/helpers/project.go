package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureProjectService(t *testing.T) service.ProjectService {
	t.Helper()
	if h.ProjectService == nil {
		h.ProjectService = service.NewProjectService(
			h.EnsureDBPool(t),
			h.ServiceDB(t),
			h.EnsureSchemaRepo(t),
			h.EnsureFlowDefinitionRepo(t),
			h.EnsureOpaqueTokenGenerator(t),
			BuiltinSchemaBaseURL,
			h.EnsureSchemaValidator(t),
		)
	}
	return h.ProjectService
}
