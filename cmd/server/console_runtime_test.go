package server

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
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
// its "run zitadel setup" state until the first project exists (ADR 0004 §2).
func TestConsoleRuntimeHandlerOmitsAbsentProject(t *testing.T) {
	handler := newConsoleRuntimeHandler(staticResolver(consoleRuntime{Mode: ConsoleModeStandalone}, nil))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, consoleRuntimePath, nil))

	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"mode":"standalone"}`, rec.Body.String())
}

// The 500 body is deliberately opaque, so the underlying cause has to reach
// the log or a broken deployment is undiagnosable from the server side.
func TestConsoleRuntimeHandlerAnswers500OnResolverError(t *testing.T) {
	handler := newConsoleRuntimeHandler(staticResolver(consoleRuntime{}, errors.New("db down")))
	records := &recordingHandler{}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, consoleRuntimePath, nil)
	req = req.WithContext(zlog.WithLoggingContext(req.Context(), slog.New(records)))
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	require.Len(t, records.records, 1)
	logged := records.records[0]
	assert.Equal(t, slog.LevelError, logged.Level)
	assert.Equal(t, "console runtime resolution failed", logged.Message)
	assert.Contains(t, recordAttrs(logged), "err=db down")
}

// recordingHandler captures emitted records so tests can assert on them.
type recordingHandler struct {
	records []slog.Record
}

func (h *recordingHandler) Enabled(context.Context, slog.Level) bool { return true }

func (h *recordingHandler) Handle(_ context.Context, r slog.Record) error {
	h.records = append(h.records, r)
	return nil
}

func (h *recordingHandler) WithAttrs([]slog.Attr) slog.Handler { return h }

func (h *recordingHandler) WithGroup(string) slog.Handler { return h }

func recordAttrs(r slog.Record) []string {
	var attrs []string
	r.Attrs(func(attr slog.Attr) bool {
		attrs = append(attrs, attr.Key+"="+attr.Value.String())
		return true
	})
	return attrs
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

// TestLoadConfigReadsPlatformProjectIDEnv locks in the Console ADR 0004 §2
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

func (f *fakeProjectService) CreateWithID(context.Context, string, string, []string, bool) (*domain.Project, error) {
	panic("unused")
}

func (f *fakeProjectService) Get(context.Context, string) (*domain.Project, error) {
	panic("unused")
}

func (f *fakeProjectService) Update(context.Context, string, string) (*domain.Project, error) {
	panic("unused")
}

func (f *fakeProjectService) List(context.Context, service.ListProjectsRequest) (*service.ListProjectsResponse, error) {
	panic("unused")
}

func (f *fakeProjectService) Delete(context.Context, string) error {
	panic("unused")
}

func (f *fakeProjectService) DefaultProject(context.Context, string) (*domain.Project, error) {
	return f.project, f.err
}

func TestStandaloneRuntimeResolverWithoutProject(t *testing.T) {
	ctrl := gomock.NewController(t)
	tokens := servicemocks.NewMockTokenService(ctrl)
	tokens.EXPECT().GetActivePreviewToken(gomock.Any(), gomock.Any()).Times(0)
	tokens.EXPECT().GenerateJWE(gomock.Any(), gomock.Any()).Times(0)

	resolve := standaloneRuntimeResolver(&fakeProjectService{}, tokens, servicemocks.NewMockKeyService(ctrl), "")
	meta, err := resolve(context.Background())

	require.NoError(t, err)
	assert.Equal(t, consoleRuntime{Mode: ConsoleModeStandalone}, meta)
}

// The document is resolved per request, so the project's existing preview
// record is re-encrypted rather than replaced: no token row per page load, and
// revoking the preview secret retires the published key with it.
func TestStandaloneRuntimeResolverReusesPreviewToken(t *testing.T) {
	ctrl := gomock.NewController(t)
	project := &domain.Project{ID: "proj_first"}

	tokens := servicemocks.NewMockTokenService(ctrl)
	tokens.EXPECT().
		GetActivePreviewToken(gomock.Any(), project.ID).
		Return(&domain.Token{ProjectID: project.ID, TokenID: "tkn_preview", Type: domain.TokenTypeProjectPreview}, nil)
	tokens.EXPECT().GenerateJWE(gomock.Any(), gomock.Any()).Times(0)

	crypter := cryptomock.NewMockCrypter(ctrl)
	crypter.EXPECT().
		Encrypt(gomock.Any()).
		DoAndReturn(func(payload string) (string, error) {
			assert.Contains(t, payload, `"TokenID":"tkn_preview"`)
			return "pk_preview", nil
		})
	keys := servicemocks.NewMockKeyService(ctrl)
	keys.EXPECT().
		GetProjectCrypter(gomock.Any(), project.ID, domain.EncryptionKeyPurposeToken).
		Return(crypter, nil)

	resolve := standaloneRuntimeResolver(&fakeProjectService{project: project}, tokens, keys, "")
	meta, err := resolve(context.Background())

	require.NoError(t, err)
	assert.Equal(t, consoleRuntime{
		Mode:             ConsoleModeStandalone,
		ConsoleProjectID: "proj_first",
		PublishableKey:   "pk_preview",
	}, meta)
}

// A project with no preview record yet — a fresh deployment, or one whose
// preview secret was revoked — mints one, or the console never boots.
func TestStandaloneRuntimeResolverMintsWhenPreviewTokenIsGone(t *testing.T) {
	ctrl := gomock.NewController(t)
	project := &domain.Project{ID: "proj_first"}

	tokens := servicemocks.NewMockTokenService(ctrl)
	tokens.EXPECT().
		GetActivePreviewToken(gomock.Any(), project.ID).
		Return(nil, domain.TokenNotFound())
	tokens.EXPECT().
		GenerateJWE(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, token *domain.Token) (string, error) {
			assert.Equal(t, domain.TokenTypeProjectPreview, token.Type)
			return "pk_minted", nil
		})

	resolve := standaloneRuntimeResolver(&fakeProjectService{project: project}, tokens, servicemocks.NewMockKeyService(ctrl), "")
	meta, err := resolve(context.Background())

	require.NoError(t, err)
	assert.Equal(t, "pk_minted", meta.PublishableKey)
}

// A lookup that fails for any other reason must not fall through to minting:
// that would write a row per request whenever the read is broken.
func TestStandaloneRuntimeResolverPropagatesPreviewTokenError(t *testing.T) {
	ctrl := gomock.NewController(t)
	project := &domain.Project{ID: "proj_first"}

	tokens := servicemocks.NewMockTokenService(ctrl)
	tokens.EXPECT().
		GetActivePreviewToken(gomock.Any(), project.ID).
		Return(nil, domain.ErrInternal(errors.New("db down")))
	tokens.EXPECT().GenerateJWE(gomock.Any(), gomock.Any()).Times(0)

	resolve := standaloneRuntimeResolver(&fakeProjectService{project: project}, tokens, servicemocks.NewMockKeyService(ctrl), "")
	_, err := resolve(context.Background())

	assert.Error(t, err)
}

func TestStandaloneRuntimeResolverPropagatesProjectError(t *testing.T) {
	ctrl := gomock.NewController(t)
	tokens := servicemocks.NewMockTokenService(ctrl)

	resolve := standaloneRuntimeResolver(&fakeProjectService{err: errors.New("db down")}, tokens, servicemocks.NewMockKeyService(ctrl), "")
	_, err := resolve(context.Background())

	assert.Error(t, err)
}
