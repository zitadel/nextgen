package helpers

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	generated "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/service"
)

// serverLog is a concurrency-safe sink for the test server's request logs.
type serverLog struct {
	mutex sync.Mutex
	buf   bytes.Buffer
}

func (l *serverLog) Write(p []byte) (int, error) {
	l.mutex.Lock()
	defer l.mutex.Unlock()
	return l.buf.Write(p)
}

// ServerLog is everything the server under test has logged so far. Tests use
// it above all negatively: a secret, a code or a state in here is a leak.
func (h *Harness) ServerLog() string {
	h.serverLog.mutex.Lock()
	defer h.serverLog.mutex.Unlock()
	return h.serverLog.buf.String()
}

func (h *Harness) EnsureTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	h.testServer.mutex.Lock()
	defer h.testServer.mutex.Unlock()

	if h.testServer.value == nil {
		callback := api.NewIDPCallbackHandler(service.NewFlowSSOCallback(
			h.EnsureIDPConnectionService(t),
			h.EnsureAuthAttemptService(t),
			h.EnsureKeyService(t),
			h.EnsureVariableService(t),
			h.EnsureHttpClient(t),
		))
		// The same mounts as the production mux (buildHTTPMux), not its
		// middleware chain: the callback on both its spellings and the retired
		// shared route, ahead of the API catch-all.
		mux := http.NewServeMux()
		require.NoError(t, api.MountIDPCallback(mux, callback, func(next http.Handler) http.Handler {
			return h.withServerLog(next, "code", "state")
		}))
		mux.Handle("/", h.withServerLog(api.WithSessionStateNoStore(api.WithCSRFRequest(h.EnsureGeneratedServer(t)))))
		h.testServer.value = httptest.NewServer(mux)
	}
	return h.testServer.value
}

// withServerLog hands every request a logger collecting into the harness, the
// way the production middleware hands one writing to the process log, and runs
// the production request logging on top so the buffer holds real log lines.
// redactQuery is the mount's opt-in, as in production.
func (h *Harness) withServerLog(next http.Handler, redactQuery ...string) http.Handler {
	logger := slog.New(slog.NewTextHandler(&h.serverLog, nil))
	logging := middleware.WithLogging(next, redactQuery...)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		logging.ServeHTTP(w, r.WithContext(zlog.WithLoggingContext(r.Context(), logger)))
	})
}

func (h *Harness) EnsureGeneratedServer(t *testing.T) *generated.Server {
	t.Helper()
	h.generatedServer.mutex.Lock()
	defer h.generatedServer.mutex.Unlock()

	if h.generatedServer.value == nil {
		var err error
		h.generatedServer.value, err = generated.NewServer(
			h.EnsureHandler(t),
			h.EnsureSecurityHandler(t),
			generated.WithErrorHandler(api.OgenErrorHandler),
		)
		require.NoError(t, err)
	}
	return h.generatedServer.value
}

func (h *Harness) EnsureHandler(t *testing.T) *api.Handler {
	t.Helper()
	h.handler.mutex.Lock()
	defer h.handler.mutex.Unlock()

	if h.handler.value == nil {
		platform := h.EnsurePlatformProject(t)
		h.handler.value = api.NewHandler(
			h.EnsureFlowService(t),
			h.EnsureAuthAttemptService(t),
			h.EnsureSessionService(t),
			// Unwrapped: the handler is cached for the whole run, so a wrapper
			// here would register every later test's cleanup on whichever test
			// happened to build the handler first. A test that creates a project
			// over HTTP calls Harness.CleanupProject itself.
			h.ensureProjectService(t),
			h.EnsureUserService(t),
			h.EnsureSchemaService(t),
			h.EnsureFlowDefinitionService(t),
			h.EnsureTeamService(t),
			h.EnsureBrandingService(t),
			h.EnsureEnvironmentService(t),
			h.EnsureReleaseService(t),
			h.EnsureIDPConnectionService(t),
			h.EnsureDeploymentService(t),
			h.EnsureEventService(t),
			h.EnsureTokenService(t),
			h.EnsureKeyService(t),
			service.NewClaimService(h.EnsureServiceDB(t), "https://console.invalid/ui/console", platform.ID),
			service.NewGrantService(h.EnsureServiceDB(t), service.StatementsUserRefResolver{Pool: h.EnsureServiceDB(t)}, platform.ID),
			service.NewVariableService(h.EnsureServiceDB(t), h.EnsureKeyService(t)),
			h.EnsureServiceDB(t),
			platform.ID,
		)
	}
	return h.handler.value
}

func (h *Harness) EnsureSecurityHandler(t *testing.T) *api.SecurityHandler {
	t.Helper()
	h.securityHandler.mutex.Lock()
	defer h.securityHandler.mutex.Unlock()

	if h.securityHandler.value == nil {
		h.securityHandler.value = api.NewSecurityHandler(
			h.EnsureTokenService(t),
		)
	}
	return h.securityHandler.value
}
