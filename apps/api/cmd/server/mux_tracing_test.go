package server

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	slogctx "github.com/veqryn/slog-context"
	slogotel "github.com/veqryn/slog-context/otel"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric/noop"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/mock/gomock"

	openapibundled "github.com/zitadel/nextgen/api/openapi/bundled"
	"github.com/zitadel/nextgen/internal/api"
	oasapi "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/instrumentation/zotel"
	"github.com/zitadel/nextgen/internal/securityheaders"
	"github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/dialect/idgen"
)

var (
	muxSpans          = tracetest.NewInMemoryExporter()
	muxTracerProvider = sdktrace.NewTracerProvider(
		sdktrace.WithSyncer(muxSpans),
		sdktrace.WithSampler(zotel.NewSampler(1.0)),
	)
)

// TestMain sets the global provider before any test runs: the audit package
// tracer delegates to the first provider set in the process, and the migrate
// tests set one of their own.
func TestMain(m *testing.M) {
	otel.SetTracerProvider(muxTracerProvider)
	os.Exit(m.Run())
}

// The enqueue span of the audit middleware is a child of the request's server
// span and runs inside it: the span opens in front of the whole chain, so it
// is still open when the middleware behind the operation runs. A request that
// authenticates and then fails decoding is audited too, so it is linked as
// well.
func TestBuildHTTPMuxTracesTheAuditEventUnderTheServerSpan(t *testing.T) {
	for _, tt := range []struct {
		name       string
		body       string
		wantStatus int
	}{
		{name: "request reaches the handler", body: `{"attributes":{"nickname":"n"}}`, wantStatus: http.StatusInternalServerError},
		{name: "request fails decoding", body: `{`, wantStatus: http.StatusBadRequest},
	} {
		t.Run(tt.name, func(t *testing.T) {
			muxSpans.Reset()
			tokens := mocks.NewMockTokenService(gomock.NewController(t))
			tokens.EXPECT().IntrospectToken(gomock.Any(), "secret").
				Return(&domain.Token{Type: domain.TokenTypeProjectToken, ProjectID: "proj_1"}, nil)
			apiServers, err := api.NewServers(oasapi.UnimplementedHandler{}, api.NewSecurityHandler(tokens),
				apiServerOptions(muxTracerProvider, noop.NewMeterProvider(), nil, 0)...)
			require.NoError(t, err)
			events := audit.NewRequestBuffer(audit.BatchInserter(func(context.Context, []*domain.Event) error { return nil }), audit.RequestBufferConfig{})
			t.Cleanup(events.Close)
			mux, err := buildHTTPMux(ServerConfig{}, idgen.NewULID(), apiServers, idpCallbackEcho(), nil, events, nil, nil)
			require.NoError(t, err)
			handler := withTracing(instrumentation.TraceConfig{}, propagation.TraceContext{}, muxTracerProvider, mux)

			r := httptest.NewRequest(http.MethodPatch, "/api/v1/users/user_1", strings.NewReader(tt.body))
			r.Header.Set("Authorization", "Bearer secret")
			r.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, r)
			require.Equal(t, tt.wantStatus, rec.Code)

			spans := map[string]tracetest.SpanStub{}
			for _, s := range muxSpans.GetSpans() {
				spans[s.Name] = s
			}
			server, ok := spans["UpdateUser"]
			require.True(t, ok, "no server span")
			enqueue, ok := spans["audit.EnqueueRequestEvent"]
			require.True(t, ok, "no enqueue span")
			assert.Equal(t, server.SpanContext, enqueue.Parent, "the enqueue span is a child of the server span")
			assert.False(t, enqueue.StartTime.Before(server.StartTime), "the enqueue span starts inside the server span")
			assert.False(t, enqueue.EndTime.After(server.EndTime), "the server span covers the middleware behind the operation")
		})
	}
}

// liveHandler answers the liveness probe and nothing else.
type liveHandler struct{ oasapi.UnimplementedHandler }

func (liveHandler) GetLive(context.Context) (oasapi.GetLiveRes, error) {
	return &oasapi.GetLiveOK{}, nil
}

// Every request has exactly one server span, whatever answers it: an
// operation, the API's own answer for a request no operation takes, or a
// mount outside the API. An operation names its span and gives it the route;
// any other request keeps the method for a name and has no route. With
// trust_remote_spans on the span is the child of the caller's span, which is
// how the hosted cloud's wrapper finds the span of a request it forwarded.
func TestBuildHTTPMuxGivesEveryRequestOneServerSpan(t *testing.T) {
	apiServers, err := api.NewServers(liveHandler{}, api.NewSecurityHandler(nil),
		apiServerOptions(muxTracerProvider, noop.NewMeterProvider(), nil, 0)...)
	require.NoError(t, err)
	retention := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusAccepted) })
	mux, err := buildHTTPMux(ServerConfig{}, idgen.NewULID(), apiServers, idpCallbackEcho(),
		staticResolver(consoleRuntime{Mode: ConsoleModeStandalone}, nil), nil, retention, nil)
	require.NoError(t, err)
	handler := withTracing(instrumentation.TraceConfig{TrustRemoteSpans: true}, propagation.TraceContext{}, muxTracerProvider, mux)

	for _, tt := range []struct {
		name       string
		method     string
		path       string
		preflight  bool
		wantStatus int
		// wantName is the span's name; the method when empty.
		wantName string
		// wantRoute is the http.route of an operation's span.
		wantRoute string
		wantAttrs []attribute.KeyValue
	}{
		{name: "an operation under the prefix", method: http.MethodGet, path: "/api/v1/livez", wantStatus: http.StatusOK, wantName: "GetLive", wantRoute: "/livez"},
		{name: "a probe at the root", method: http.MethodGet, path: "/livez", wantStatus: http.StatusOK, wantName: "GetLive", wantRoute: "/livez"},
		{
			name: "an operation at its root path", method: http.MethodGet, path: "/sessions/me", wantStatus: http.StatusUnauthorized,
			wantName: "GetMySession", wantRoute: "/sessions/me", wantAttrs: []attribute.KeyValue{api.RootPathAttribute},
		},
		{name: "an operation that fails", method: http.MethodGet, path: "/api/v1/readyz", wantStatus: http.StatusInternalServerError, wantName: "GetReady", wantRoute: "/readyz"},
		{name: "a path the API lacks", method: http.MethodGet, path: "/api/v1/no-such-page", wantStatus: http.StatusNotFound},
		{name: "the bare prefix", method: http.MethodGet, path: "/api/v1", wantStatus: http.StatusNotFound},
		{name: "a path at the root", method: http.MethodPost, path: "/no-such-page", wantStatus: http.StatusNotFound},
		{name: "a method the path does not take", method: http.MethodDelete, path: "/api/v1/livez", wantStatus: http.StatusMethodNotAllowed},
		{name: "a method a probe does not take", method: http.MethodDelete, path: "/livez", wantStatus: http.StatusMethodNotAllowed},
		{name: "a CORS preflight", method: http.MethodOptions, path: "/api/v1/livez", preflight: true, wantStatus: http.StatusNoContent},
		{name: "the OpenAPI document", method: http.MethodGet, path: openapibundled.Path, wantStatus: http.StatusOK},
		{name: "the console's runtime document", method: http.MethodGet, path: consoleRuntimePath, wantStatus: http.StatusOK},
		{name: "a policy report", method: http.MethodPost, path: securityheaders.ReportPath, wantStatus: http.StatusNoContent},
		{name: "the retention trigger", method: http.MethodPost, path: audit.RetentionTriggerPath, wantStatus: http.StatusAccepted},
		{name: "the IdP callback", method: http.MethodGet, path: api.IDPCallbackPath("google"), wantStatus: http.StatusTeapot},
	} {
		t.Run(tt.name, func(t *testing.T) {
			muxSpans.Reset()
			r := httptest.NewRequest(tt.method, tt.path, nil)
			r.Header.Set("traceparent", callerTraceparent("01"))
			if tt.preflight {
				r.Header.Set("Origin", "https://app.example.com")
				r.Header.Set("Access-Control-Request-Method", http.MethodGet)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, r)
			require.Equal(t, tt.wantStatus, rec.Code)

			var servers []tracetest.SpanStub
			for _, s := range muxSpans.GetSpans() {
				if s.SpanKind == trace.SpanKindServer {
					servers = append(servers, s)
				}
			}
			require.Len(t, servers, 1)
			server := servers[0]
			assert.Equal(t, cmp.Or(tt.wantName, tt.method), server.Name)
			assert.Equal(t, callerSpanID, server.Parent.SpanID().String(), "the caller's span must be the parent")
			wantStatus := codes.Unset
			if tt.wantStatus >= http.StatusInternalServerError {
				wantStatus = codes.Error
			}
			assert.Equal(t, wantStatus, server.Status.Code)

			attrs := attribute.NewSet(server.Attributes...)
			method, _ := attrs.Value("http.request.method")
			assert.Equal(t, tt.method, method.AsString())
			status, _ := attrs.Value("http.response.status_code")
			assert.EqualValues(t, tt.wantStatus, status.AsInt64())
			route, hasRoute := attrs.Value("http.route")
			assert.Equal(t, tt.wantRoute, route.AsString())
			assert.Equal(t, tt.wantRoute != "", hasRoute)
			for _, want := range tt.wantAttrs {
				assert.Contains(t, server.Attributes, want)
			}
			if tt.wantRoute == "" {
				assert.Len(t, server.Attributes, 2, "a request no operation answers has its method and status alone: %v", server.Attributes)
			}
		})
	}
}

// Every log line of a request carries the IDs of its server span, the request
// line included: the span opens in front of the logging middleware and ends
// after it, on a mount of the API and on one outside it.
func TestBuildHTTPMuxLogsARequestUnderItsServerSpan(t *testing.T) {
	apiServers, err := api.NewServers(liveHandler{}, api.NewSecurityHandler(nil),
		apiServerOptions(muxTracerProvider, noop.NewMeterProvider(), nil, 0)...)
	require.NoError(t, err)
	mux, err := buildHTTPMux(ServerConfig{}, idgen.NewULID(), apiServers, idpCallbackEcho(),
		staticResolver(consoleRuntime{Mode: ConsoleModeStandalone}, nil), nil, nil, nil)
	require.NoError(t, err)
	handler := withTracing(instrumentation.TraceConfig{}, propagation.TraceContext{}, muxTracerProvider, mux)

	for _, path := range []string{"/api/v1/livez", "/api/v1/no-such-page", consoleRuntimePath} {
		t.Run(path, func(t *testing.T) {
			muxSpans.Reset()
			var logs bytes.Buffer
			logger := slog.New(slogctx.NewHandler(slog.NewJSONHandler(&logs, nil), &slogctx.HandlerOptions{
				Prependers: []slogctx.AttrExtractor{slogotel.ExtractTraceSpanID},
			}))
			r := httptest.NewRequestWithContext(zlog.WithLoggingContext(t.Context(), logger), http.MethodGet, path, nil)
			handler.ServeHTTP(httptest.NewRecorder(), r)

			spans := muxSpans.GetSpans()
			require.Len(t, spans, 1)
			server := spans[0].SpanContext
			var messages []string
			for _, raw := range bytes.Split(bytes.TrimSpace(logs.Bytes()), []byte("\n")) {
				var line map[string]any
				require.NoError(t, json.Unmarshal(raw, &line), "%q", raw)
				assert.Equal(t, server.TraceID().String(), line[slogotel.DefaultKeyTraceID], "%s", raw)
				assert.Equal(t, server.SpanID().String(), line[slogotel.DefaultKeySpanID], "%s", raw)
				messages = append(messages, line["msg"].(string))
			}
			assert.Contains(t, messages, "request served")
		})
	}
}
