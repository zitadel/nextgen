package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric/noop"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/api"
	oasapi "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation"
	"github.com/zitadel/nextgen/internal/instrumentation/zotel"
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

// The enqueue span of the audit middleware is a child of the ogen server span
// only with the real chain: WithLogging plants the holder outside the audit
// middleware, and the ogen tracer fills it when the server span starts. A
// request that authenticates and then fails decoding is audited too, so it is
// linked as well.
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

			r := httptest.NewRequest(http.MethodPatch, "/api/v1/users/user_1", strings.NewReader(tt.body))
			r.Header.Set("Authorization", "Bearer secret")
			r.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, r)
			require.Equal(t, tt.wantStatus, rec.Code)

			spans := map[string]tracetest.SpanStub{}
			for _, s := range muxSpans.GetSpans() {
				spans[s.Name] = s
			}
			server, ok := spans["PatchUserByID"]
			require.True(t, ok, "no server span")
			enqueue, ok := spans["audit.EnqueueRequestEvent"]
			require.True(t, ok, "no enqueue span")
			assert.Equal(t, server.SpanContext, enqueue.Parent, "the enqueue span is a child of the server span")
		})
	}
}

// A request no operation answers has a server span on every mount of the
// real chain, though ogen starts one only in an operation's handler. With
// trust_remote_spans on it is the child of the caller's span: the hosted
// cloud's wrapper holds a response back until the span with that parent
// arrives.
func TestBuildHTTPMuxTracesARequestNoOperationAnswers(t *testing.T) {
	apiServers, err := api.NewServers(oasapi.UnimplementedHandler{}, api.NewSecurityHandler(nil),
		apiServerOptions(muxTracerProvider, noop.NewMeterProvider(), nil, 0)...)
	require.NoError(t, err)
	mux, err := buildHTTPMux(ServerConfig{}, idgen.NewULID(), apiServers, idpCallbackEcho(), nil, nil, nil, nil)
	require.NoError(t, err)
	handler := withIncomingTraceContext(instrumentation.TraceConfig{TrustRemoteSpans: true}, propagation.TraceContext{}, mux)

	for _, tt := range []struct {
		name       string
		method     string
		path       string
		wantStatus int
	}{
		{name: "a path the API lacks", method: http.MethodGet, path: "/api/v1/no-such-page", wantStatus: http.StatusNotFound},
		{name: "the bare prefix", method: http.MethodGet, path: "/api/v1", wantStatus: http.StatusNotFound},
		{name: "a path at the root", method: http.MethodPost, path: "/no-such-page", wantStatus: http.StatusNotFound},
		{name: "a method the path does not take", method: http.MethodDelete, path: "/api/v1/livez", wantStatus: http.StatusMethodNotAllowed},
		{name: "a method a probe does not take", method: http.MethodDelete, path: "/livez", wantStatus: http.StatusMethodNotAllowed},
	} {
		t.Run(tt.name, func(t *testing.T) {
			muxSpans.Reset()
			r := httptest.NewRequest(tt.method, tt.path, nil)
			r.Header.Set("traceparent", callerTraceparent("01"))
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, r)
			require.Equal(t, tt.wantStatus, rec.Code)

			spans := muxSpans.GetSpans()
			require.Len(t, spans, 1)
			assert.Equal(t, trace.SpanKindServer, spans[0].SpanKind)
			assert.Equal(t, tt.method, spans[0].Name)
			assert.Equal(t, callerSpanID, spans[0].Parent.SpanID().String(), "the caller's span must be the parent")
			assert.Equal(t, []attribute.KeyValue{
				attribute.String("http.request.method", tt.method),
				attribute.Int("http.response.status_code", tt.wantStatus),
			}, spans[0].Attributes)
		})
	}
}
