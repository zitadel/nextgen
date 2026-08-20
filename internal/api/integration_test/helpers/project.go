package helpers

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
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

// EnsurePlatformProject lazily creates the deployment's platform project
// (ADR 046 §2) whose id is pinned on the handler and claim service. The
// fixed-id proj_platform bootstrap only writes the project row — no keyset,
// schemas, or flow definitions — so real logins against it are impossible; a
// normal fully provisioned project stands in.
func (h *Harness) EnsurePlatformProject(t *testing.T) *domain.Project {
	t.Helper()
	h.platformProject.mutex.Lock()
	defer h.platformProject.mutex.Unlock()

	if h.platformProject.value == nil {
		project, err := h.EnsureProjectService(t).Create(t.Context(), ProjectName(), nil, true)
		require.NoError(t, err)
		h.platformProject.value = project
	}
	return h.platformProject.value
}
