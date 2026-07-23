package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"go.uber.org/mock/gomock"
)

func staticResolver(meta consoleRuntime, err error) runtimeResolver {
	return func(context.Context) (consoleRuntime, error) { return meta, err }
}

func TestConsoleRuntimeHandlerServesPublicMetadata(t *testing.T) {
	handler := newConsoleRuntimeHandler(staticResolver(consoleRuntime{
		Mode:             ConsoleModeStandalone,
		ConsoleProjectID: "proj_first",
		PublishableKey:   "pk_test",
	}, nil))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, consoleRuntimePath, nil))

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
	assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))

	var payload map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	assert.Equal(t, map[string]string{
		"mode":               "standalone",
		"console_project_id": "proj_first",
		"publishable_key":    "pk_test",
	}, payload)
}

// A deployment with no project yet answers with mode only: the console shows
// its "run zitadel setup" state until the first project exists (ADR 0004 §3).
func TestConsoleRuntimeHandlerOmitsAbsentProject(t *testing.T) {
	handler := newConsoleRuntimeHandler(staticResolver(consoleRuntime{Mode: ConsoleModeStandalone}, nil))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, consoleRuntimePath, nil))

	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"mode":"standalone"}`, rec.Body.String())
}

func TestConsoleRuntimeHandlerAnswers500OnResolverError(t *testing.T) {
	handler := newConsoleRuntimeHandler(staticResolver(consoleRuntime{}, errors.New("db down")))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, consoleRuntimePath, nil))

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

func TestConsoleRuntimeHandlerHeadHasNoBody(t *testing.T) {
	handler := newConsoleRuntimeHandler(staticResolver(consoleRuntime{Mode: ConsoleModeStandalone}, nil))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodHead, consoleRuntimePath, nil))

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Empty(t, rec.Body.Bytes())
}

func TestConsoleRuntimeHandlerRejectsNonReadMethods(t *testing.T) {
	handler := newConsoleRuntimeHandler(staticResolver(consoleRuntime{Mode: ConsoleModeStandalone}, nil))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, consoleRuntimePath, nil))

	assert.Equal(t, http.StatusMethodNotAllowed, rec.Code)
	assert.Equal(t, "GET, HEAD", rec.Header().Get("Allow"))
}

// TestLoadConfigReadsPlatformProjectIDEnv locks in the Console ADR 0004 §3
// config surface: NEXTGEN_PLATFORM_PROJECT_ID pins the default project,
// and the empty default means "first-created project wins".
func TestLoadConfigReadsPlatformProjectIDEnv(t *testing.T) {
	t.Setenv("NEXTGEN_SERVER_ENCRYPTION_KEY", "4D61737465726B65794E65656473546F48617665333243686172616374657273")
	t.Setenv("NEXTGEN_PLATFORM_PROJECT_ID", "proj_custom")

	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)
	assert.Equal(t, "proj_custom", cfg.Platform.ProjectID)
}

func TestLoadConfigPlatformProjectIDDefaultsToEmpty(t *testing.T) {
	t.Setenv("NEXTGEN_SERVER_ENCRYPTION_KEY", "4D61737465726B65794E65656473546F48617665333243686172616374657273")

	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)
	assert.Empty(t, cfg.Platform.ProjectID)
}

// fakeProjectService pins DefaultProject for resolver tests; the other
// ProjectService methods are unused by the resolver.
type fakeProjectService struct {
	project *domain.Project
	err     error
}

var _ service.ProjectService = (*fakeProjectService)(nil)

func (f *fakeProjectService) Create(context.Context, string, []string, bool) (*domain.Project, error) {
	panic("unused")
}

func (f *fakeProjectService) Get(context.Context, string) (*domain.Project, error) {
	panic("unused")
}

func (f *fakeProjectService) DefaultProject(context.Context, string) (*domain.Project, error) {
	return f.project, f.err
}

func TestStandaloneRuntimeResolverWithoutProject(t *testing.T) {
	ctrl := gomock.NewController(t)
	keys := servicemocks.NewMockKeyService(ctrl)
	keys.EXPECT().GetProjectDEKCrypter(gomock.Any(), gomock.Any()).Times(0)

	resolve := standaloneRuntimeResolver(&fakeProjectService{}, keys, "")
	meta, err := resolve(context.Background())

	require.NoError(t, err)
	assert.Equal(t, consoleRuntime{Mode: ConsoleModeStandalone}, meta)
}

func TestStandaloneRuntimeResolverDerivesPublishableKey(t *testing.T) {
	ctrl := gomock.NewController(t)
	dek := cryptomock.NewMockCrypter(ctrl)
	// PreviewSecret serializes the read-only token and encrypts it with the
	// project DEK; the mocked crypter stands in for the JWE output.
	dek.EXPECT().Encrypt(gomock.Any()).Return("pk_preview", nil)
	keys := servicemocks.NewMockKeyService(ctrl)
	keys.EXPECT().GetProjectDEKCrypter(gomock.Any(), "proj_first").Return(dek, nil)

	resolve := standaloneRuntimeResolver(
		&fakeProjectService{project: &domain.Project{ID: "proj_first"}},
		keys,
		"",
	)
	meta, err := resolve(context.Background())

	require.NoError(t, err)
	assert.Equal(t, consoleRuntime{
		Mode:             ConsoleModeStandalone,
		ConsoleProjectID: "proj_first",
		PublishableKey:   "pk_preview",
	}, meta)
}

func TestStandaloneRuntimeResolverPropagatesProjectError(t *testing.T) {
	ctrl := gomock.NewController(t)
	keys := servicemocks.NewMockKeyService(ctrl)

	resolve := standaloneRuntimeResolver(&fakeProjectService{err: errors.New("db down")}, keys, "")
	_, err := resolve(context.Background())

	assert.Error(t, err)
}
