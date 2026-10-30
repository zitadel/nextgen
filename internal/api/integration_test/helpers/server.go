package helpers

import (
	"bytes"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	generated "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dialect/idgen"
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

// The fields of a text log line, as WithLogging writes them: the request id
// at the root and the request fields in the request group.
var (
	requestIDField = regexp.MustCompile(`\brequest_id=(\S+)`)
	methodField    = regexp.MustCompile(`\brequest\.method=(\S+)`)
	pathField      = regexp.MustCompile(`\brequest\.path=("[^"]*"|\S+)`)
)

func logField(pattern *regexp.Regexp, line string) string {
	if match := pattern.FindStringSubmatch(line); match != nil {
		return match[1]
	}
	return ""
}

// UnrecordedErrors is non-nil when the server under test answered an error
// without recording its cause (middleware.UnrecordedErrorMessage), and names
// each such request by the request line sharing its request id. The run
// fails on it: the route that answered calls middleware.RecordError.
func (h *Harness) UnrecordedErrors() error {
	requests := map[string]string{}
	var unrecorded []string
	for line := range strings.Lines(h.ServerLog()) {
		id := logField(requestIDField, line)
		switch {
		case strings.Contains(line, `msg="request served"`):
			requests[id] = logField(methodField, line) + " " + logField(pathField, line)
		case strings.Contains(line, `msg="`+middleware.UnrecordedErrorMessage+`"`):
			unrecorded = append(unrecorded, id)
		}
	}
	if len(unrecorded) == 0 {
		return nil
	}
	named := make([]string, len(unrecorded))
	for i, id := range unrecorded {
		named[i] = requests[id] + " (request_id " + id + ")"
	}
	return fmt.Errorf("%d answers without a recorded error, see middleware.RecordError: %s",
		len(named), strings.Join(named, "; "))
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
		// middleware chain: the callback on both its spellings, ahead of the
		// API catch-all.
		mux := http.NewServeMux()
		mux.Handle(api.IDPCallbackPattern, callback)
		mux.Handle(api.IDPCallbackUpstreamPattern, callback)
		mux.Handle("/", h.withServerLog(api.WithSessionStateNoStore(api.WithCSRFRequest(h.EnsureGeneratedServer(t)))))
		h.testServer.value = httptest.NewServer(mux)
	}
	return h.testServer.value
}

// withServerLog hands every request a logger collecting into the harness, the
// way the production middleware hands one writing to the process log, and runs
// the production request ID, request logging and panic recovery on top so the
// buffer holds real log lines, each naming its request.
func (h *Harness) withServerLog(next http.Handler) http.Handler {
	logger := slog.New(slog.NewTextHandler(&h.serverLog, nil))
	logging := middleware.WithRequestContextMiddleware(idgen.NewULID(), "",
		middleware.WithLogging(api.WithRecover(next)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		logging.ServeHTTP(w, r.WithContext(zlog.WithLoggingContext(r.Context(), logger)))
	})
}

func (h *Harness) EnsureGeneratedServer(t testing.TB) *generated.Server {
	t.Helper()
	h.generatedServer.mutex.Lock()
	defer h.generatedServer.mutex.Unlock()

	if h.generatedServer.value == nil {
		var err error
		h.generatedServer.value, err = generated.NewServer(
			h.EnsureHandler(t),
			h.EnsureSecurityHandler(t),
			generated.WithErrorHandler(api.OgenErrorHandler),
			generated.WithNotFound(api.OgenNotFound(nil)),
			generated.WithMethodNotAllowed(api.OgenMethodNotAllowed),
			generated.WithTracerProvider(api.NewOgenTracerProvider(otel.GetTracerProvider())),
		)
		require.NoError(t, err)
	}
	return h.generatedServer.value
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
			h.EnsureEventService(t),
			h.EnsureTokenService(t),
			h.EnsureKeyService(t),
			service.NewClaimService(db, ConsoleOrigin+"/ui/console", platform.ID),
			service.NewGrantService(db, service.StatementsUserRefResolver{Pool: db}, platform.ID),
			service.NewVariableService(db, h.EnsureKeyService(t)),
			db,
			platform.ID,
		).WithBuiltinSchemaBases(BuiltinSchemaBases()).WithRuntimeResolver(service.NewRuntimeResolver(db, releaseService, ConsoleOrigin)).WithPolicyService(h.EnsurePolicyService(t))
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
