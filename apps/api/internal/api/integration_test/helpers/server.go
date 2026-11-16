//go:build postgres_integration || spanner_integration || sqlite_integration

package helpers

import (
	"bytes"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/api/client"
	openapibundled "github.com/zitadel/nextgen/api/openapi/bundled"
	"github.com/zitadel/nextgen/internal/api"
	generated "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/service"
	"go.opentelemetry.io/otel"
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

func (h *Harness) EnsureTestServer(t testing.TB) *httptest.Server {
	t.Helper()
	h.testServer.mutex.Lock()
	defer h.testServer.mutex.Unlock()

	if h.testServer.value == nil {
		callback := h.withServerLog(api.NewIDPCallbackHandler(service.NewFlowSSOCallback(
			h.EnsureIDPConnectionService(t),
			h.EnsureAuthAttemptService(t),
			h.EnsureKeyService(t),
			h.EnsureVariableService(t),
			h.EnsureHttpClient(t),
		)))
		// The same paths as the production mux (buildHTTPMux), not its
		// middleware chain: the callback on both its spellings, then the API's
		// mounts (prefix, OpenAPI document, probes and root alias). Only the
		// API's chain is checked against the spec: the callback and the
		// document are no operations.
		mux := http.NewServeMux()
		mux.Handle(api.IDPCallbackPattern, callback)
		mux.Handle(api.IDPCallbackUpstreamPattern, callback)
		api.MountAPI(mux, func(next http.Handler) http.Handler {
			return h.SpecChecked(t, h.withServerLog(api.WithSessionStateNoStore(api.WithCSRFRequest(next))))
		}, h.withServerLog, h.EnsureAPIServers(t))
		// In front of every mount, as on the production server (withTracing).
		h.testServer.value = httptest.NewServer(middleware.WithServerSpan(otel.GetTracerProvider())(mux))
	}
	return h.testServer.value
}

// EnsureSpecValidator loads the bundled OpenAPI document every answer of the
// test server is checked against, once per run.
func (h *Harness) EnsureSpecValidator(t testing.TB) *SpecValidator {
	t.Helper()
	h.specValidator.mutex.Lock()
	defer h.specValidator.mutex.Unlock()

	if h.specValidator.value == nil {
		document, err := io.ReadAll(openapibundled.Reader())
		require.NoError(t, err)
		validator, err := NewSpecValidator(document)
		require.NoError(t, err)
		h.specValidator.value = validator
	}
	return h.specValidator.value
}

// SpecChecked checks every answer next gives against the OpenAPI spec. The
// test server's API chain goes through it; a test that mounts the API on a
// server of its own puts it in that chain.
func (h *Harness) SpecChecked(t testing.TB, next http.Handler) http.Handler {
	t.Helper()
	return h.EnsureSpecValidator(t).Wrap(next)
}

// ReportSpecConformance ends a run: it prints what the spec validator
// checked and every answer that did not match the spec, and turns a passing
// run's exit code into a failure when one did not. Call it from TestMain
// with m.Run's code.
func (h *Harness) ReportSpecConformance(code int) int {
	validator := h.specValidator.Get()
	if validator == nil {
		return code
	}
	// Close waits for the handlers still running, so an answer a client
	// had in full before its handler returned is checked before the report.
	if server := h.testServer.Get(); server != nil {
		server.Close()
	}
	fmt.Fprintln(os.Stderr, validator.Summary())
	if err := validator.CheckSpecConformance(); err != nil {
		fmt.Fprintln(os.Stderr, "FAIL:", err)
		if code == 0 {
			return 1
		}
	}
	return code
}

// APIBaseURL is where the test server answers the API: its origin, then
// client.PathPrefix (ADR 077). A raw request builds its URL on it; the
// generated client takes the origin (NewApiClient).
func (h *Harness) APIBaseURL(t testing.TB) string {
	t.Helper()
	return h.EnsureTestServer(t).URL + client.PathPrefix
}

// withServerLog hands every request a logger collecting into the harness, the
// way the production middleware hands one writing to the process log, and runs
// the production request logging and panic recovery on top so the buffer holds
// real log lines.
func (h *Harness) withServerLog(next http.Handler) http.Handler {
	logger := slog.New(slog.NewTextHandler(&h.serverLog, nil))
	logging := middleware.WithLogging(api.WithRecover(next))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		logging.ServeHTTP(w, r.WithContext(zlog.WithLoggingContext(r.Context(), logger)))
	})
}

func (h *Harness) EnsureAPIServers(t testing.TB) api.Servers {
	t.Helper()
	h.apiServers.mutex.Lock()
	defer h.apiServers.mutex.Unlock()

	if h.apiServers.value == nil {
		servers, err := api.NewServers(
			h.EnsureHandler(t),
			h.EnsureSecurityHandler(t),
			generated.WithErrorHandler(api.OgenErrorHandler(0)),
			generated.WithNotFound(api.OgenNotFound(nil)),
			generated.WithMethodNotAllowed(api.OgenMethodNotAllowed),
			generated.WithTracerProvider(api.NewOgenTracerProvider(otel.GetTracerProvider())),
		)
		require.NoError(t, err)
		h.apiServers.value = &servers
	}
	return *h.apiServers.value
}

// ConsoleOrigin is the test server's own origin, the one its
// server.public_base would name: claim URLs point at its console, and the flow
// gate admits it to open any project's flow.
const ConsoleOrigin = "https://console.invalid"

func (h *Harness) EnsureHandler(t testing.TB) *api.Handler {
	t.Helper()
	h.handler.mutex.Lock()
	defer h.handler.mutex.Unlock()

	if h.handler.value == nil {
		platform := h.EnsurePlatformProject(t)
		db := h.EnsureServiceDB(t)
		releaseService := h.EnsureReleaseService(t)
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
			releaseService,
			h.EnsureDeploymentService(t),
			h.EnsureIDPConnectionService(t),
			h.EnsureApplicationService(t),
			h.EnsureEventService(t),
			h.EnsureTokenService(t),
			h.EnsureKeyService(t),
			service.NewClaimService(db, ConsoleOrigin+"/ui/console", platform.ID),
			service.NewGrantService(db, service.StatementsUserRefResolver{Pool: db}, platform.ID),
			service.NewVariableService(db, h.EnsureKeyService(t)),
			db,
			platform.ID,
		).WithBuiltinSchemaBases(BuiltinSchemaBases()).WithRuntimeResolver(service.NewRuntimeResolver(db, releaseService, ConsoleOrigin)).WithPolicyService(h.EnsurePolicyService(t)).
			WithInvitationService(service.NewInvitationService(db, h.EnsureKeyService(t), ConsoleOrigin+"/ui/console", platform.ID))
	}
	return h.handler.value
}

func (h *Harness) EnsureSecurityHandler(t testing.TB) *api.SecurityHandler {
	t.Helper()
	h.securityHandler.mutex.Lock()
	defer h.securityHandler.mutex.Unlock()

	if h.securityHandler.value == nil {
		h.securityHandler.value = api.NewSecurityHandler(
			h.EnsureTokenService(t),
		).WithPlatformProject(h.EnsurePlatformProject(t).ID)
	}
	return h.securityHandler.value
}
