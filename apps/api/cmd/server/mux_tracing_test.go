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
	"go.opentelemetry.io/otel/metric/noop"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/mock/gomock"

	oasapi "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
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
			apiServer, err := oasapi.NewServer(oasapi.UnimplementedHandler{}, api.NewSecurityHandler(tokens),
				apiServerOptions(muxTracerProvider, noop.NewMeterProvider())...)
			require.NoError(t, err)
			events := audit.NewRequestBuffer(audit.BatchInserter(func(context.Context, []*domain.Event) error { return nil }), audit.RequestBufferConfig{})
			t.Cleanup(events.Close)
			mux, err := buildHTTPMux(ServerConfig{}, idgen.NewULID(), apiServer, idpCallbackEcho(), nil, events)
			require.NoError(t, err)

			r := httptest.NewRequest(http.MethodPatch, "/users/user_1", strings.NewReader(tt.body))
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
