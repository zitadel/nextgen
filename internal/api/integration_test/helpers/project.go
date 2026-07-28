package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureProjectService(t *testing.T) service.ProjectService {
	t.Helper()
	if h.ProjectService == nil {
		h.ProjectService = service.NewProjectService(
			h.EnsureServiceDB(t),
			BuiltinSchemaBaseURL,
			h.EnsureSchemaValidator(t),
			h.EnsureKeyService(t),
		)
	}
	return h.ProjectService
}
