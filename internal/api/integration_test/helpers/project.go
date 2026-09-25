package helpers

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// EnsureProjectService returns the shared project service wrapped so that every
// project a test creates is deleted when that test ends. Tests in this package
// share one database, so rows left behind are paid for by every test that runs
// later; the authz tables cascade from projects, so one delete takes a test's
// whole contribution with it. The convention is written down in
// internal/AGENTS.md.
func (h *Harness) EnsureProjectService(t *testing.T) service.ProjectService {
	t.Helper()
	return cleanupProjectService{
		ProjectService: h.ensureProjectService(t),
		t:              t,
		stmts:          h.EnsureServiceDB(t).Statements(),
	}
}

// ensureProjectService is the cached service itself, without the cleanup. Only
// callers whose project must outlive the test that first asked for it use this.
func (h *Harness) ensureProjectService(t *testing.T) service.ProjectService {
	t.Helper()
	h.projectService.mutex.Lock()
	defer h.projectService.mutex.Unlock()

	if h.projectService.value == nil {
		h.projectService.value = service.NewProjectService(
			h.EnsureServiceDB(t),
			BuiltinSchemaBaseURL,
			h.EnsureSchemaValidator(t),
			h.EnsureKeyService(t),
			h.EnsureHasherFactory(t),
		)
	}
	return h.projectService.value
}

// cleanupProjectService registers the delete on the test that created the
// project. It is built per call rather than cached so it holds that test's *T.
type cleanupProjectService struct {
	service.ProjectService
	t     *testing.T
	stmts service.AllStatements
}

// Create persists the project and schedules its removal. The delete is
// registered here, before anything the test itself registers, so under
// t.Cleanup's last in, first out order it runs last: every cleanup the test
// adds afterwards still sees the project.
func (s cleanupProjectService) Create(ctx context.Context, name string, previewOrigins []string, seedDefaults bool) (*domain.Project, error) {
	project, err := s.ProjectService.Create(ctx, name, previewOrigins, seedDefaults)
	if err != nil {
		return project, err
	}

	cleanupProject(s.t, s.stmts, project.ID)
	return project, nil
}

// CleanupProject deletes projectID when t ends. Use it for a project the test
// created through the API rather than through [Harness.EnsureProjectService]:
// the handler holds the unwrapped service, so that project is the test's to
// remove.
func (h *Harness) CleanupProject(t *testing.T, projectID string) {
	t.Helper()
	cleanupProject(t, h.EnsureServiceDB(t).Statements(), projectID)
}

// cleanupProject fails the owning test when the delete fails. Swallowing it
// would leave rows in the database every later test reads past, which is the
// cost this whole convention exists to avoid.
func cleanupProject(t *testing.T, stmts service.AllStatements, projectID string) {
	t.Cleanup(func() {
		// context.Background(), because t.Context() is already cancelled here.
		// A project the test deleted itself reports false, not an error.
		if _, err := stmts.DeleteProjectByID(context.Background(), projectID); err != nil {
			t.Errorf("cleanup: unable to delete project %s: %v", projectID, err)
		}
	})
}

// EnsurePlatformProject lazily creates the deployment's platform project
// (ADR 046 §2) whose id is pinned on the handler and claim service. The
// fixed-id proj_platform bootstrap only writes the project row — no keyset,
// schemas, or flow definitions — so real logins against it are impossible; a
// normal fully provisioned project stands in.
//
// It creates through the unwrapped service: this project is cached on the
// harness and pinned on the handler for the whole run, so deleting it when the
// first test that happened to need it ends would break every later test.
func (h *Harness) EnsurePlatformProject(t *testing.T) *domain.Project {
	t.Helper()
	h.platformProject.mutex.Lock()
	defer h.platformProject.mutex.Unlock()

	if h.platformProject.value == nil {
		project, err := h.ensureProjectService(t).Create(t.Context(), ProjectName(), nil, true)
		require.NoError(t, err)
		h.platformProject.value = project
	}
	return h.platformProject.value
}
