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

// Create persists the project and schedules its removal. The cleanup runs last
// among the test's cleanups (t.Cleanup is last in, first out), so whatever the
// test registered earlier still sees the project. A failed delete is logged
// rather than failed: losing a test's rows must not turn an unrelated test red.
func (s cleanupProjectService) Create(ctx context.Context, name string, previewOrigins []string, seedDefaults bool) (*domain.Project, error) {
	project, err := s.ProjectService.Create(ctx, name, previewOrigins, seedDefaults)
	if err != nil {
		return project, err
	}

	s.t.Cleanup(func() {
		// context.Background(), because t.Context() is already cancelled here.
		// A project the test deleted itself reports false, not an error.
		if _, err := s.stmts.DeleteProjectByID(context.Background(), project.ID); err != nil {
			s.t.Logf("cleanup: unable to delete project %s: %v", project.ID, err)
		}
	})
	return project, nil
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
