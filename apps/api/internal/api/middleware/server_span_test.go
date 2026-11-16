package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/zitadel/nextgen/internal/api/middleware"
)

func spanProvider(sampler sdktrace.Sampler) (*sdktrace.TracerProvider, *tracetest.InMemoryExporter) {
	exporter := tracetest.NewInMemoryExporter()
	return sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter), sdktrace.WithSampler(sampler)), exporter
}

// Every request gets one server span, named after its method and without a
// route: the path and a method the conventions do not list are the caller's
// text. The status the client saw is on it, and only a 5xx is an error.
func TestWithServerSpan(t *testing.T) {
	for _, tt := range []struct {
		name       string
		method     string
		handler    http.HandlerFunc
		wantName   string
		wantMethod string
		wantCode   int
		wantStatus codes.Code
	}{
		{
			name:       "a handler that writes nothing",
			method:     http.MethodGet,
			handler:    func(http.ResponseWriter, *http.Request) {},
			wantName:   "GET",
			wantMethod: "GET",
			wantCode:   http.StatusOK,
		},
		{
			name:       "a body without a status",
			method:     http.MethodPost,
			handler:    func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("ok")) },
			wantName:   "POST",
			wantMethod: "POST",
			wantCode:   http.StatusOK,
		},
		{
			name:       "a 4xx leaves the status unset",
			method:     http.MethodDelete,
			handler:    func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNotFound) },
			wantName:   "DELETE",
			wantMethod: "DELETE",
			wantCode:   http.StatusNotFound,
		},
		{
			name:       "a 5xx is an error",
			method:     http.MethodGet,
			handler:    func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusServiceUnavailable) },
			wantName:   "GET",
			wantMethod: "GET",
			wantCode:   http.StatusServiceUnavailable,
			wantStatus: codes.Error,
		},
		{
			name:       "a method of the caller's own",
			method:     "ALICE",
			handler:    func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNotFound) },
			wantName:   "HTTP",
			wantMethod: "_OTHER",
			wantCode:   http.StatusNotFound,
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			provider, exporter := spanProvider(sdktrace.AlwaysSample())
			handler := middleware.WithServerSpan(provider)(tt.handler)

			handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(tt.method, "/users/alice@example.com", nil))

			spans := exporter.GetSpans()
			require.Len(t, spans, 1)
			assert.Equal(t, trace.SpanKindServer, spans[0].SpanKind)
			assert.Equal(t, tt.wantName, spans[0].Name)
			assert.Equal(t, []attribute.KeyValue{
				attribute.String("http.request.method", tt.wantMethod),
				attribute.Int("http.response.status_code", tt.wantCode),
			}, spans[0].Attributes)
			assert.Equal(t, sdktrace.Status{Code: tt.wantStatus}, spans[0].Status)
			assert.False(t, spans[0].Parent.IsValid(), "a root")
		})
	}
}

// The handler that answers the request finds its span, to name and describe:
// as the active span of its context and through ServerSpan. The span is open
// while the handler runs, and what the handler starts is its child.
func TestWithServerSpan_handsTheHandlerTheSpan(t *testing.T) {
	provider, exporter := spanProvider(sdktrace.AlwaysSample())
	handler := middleware.WithServerSpan(provider)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		span, ok := middleware.ServerSpan(r.Context())
		require.True(t, ok)
		assert.True(t, span.IsRecording())
		assert.Equal(t, span.SpanContext(), trace.SpanContextFromContext(r.Context()))
		span.SetName("GetMyUser")
		span.SetAttributes(attribute.String("http.route", "/users/me"))

		_, child := provider.Tracer("test").Start(r.Context(), "UserService.GetUser")
		child.End()
	}))

	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/users/me", nil))

	spans := exporter.GetSpans()
	require.Len(t, spans, 2)
	child, server := spans[0], spans[1]
	assert.Equal(t, "GetMyUser", server.Name)
	assert.Contains(t, server.Attributes, attribute.String("http.route", "/users/me"))
	assert.Equal(t, server.SpanContext, child.Parent)
	assert.False(t, child.EndTime.After(server.EndTime), "the server span ends last")

	_, ok := middleware.ServerSpan(t.Context())
	assert.False(t, ok, "a request that did not pass the middleware has none")
}

// A request the sampler drops pays for the start alone: its span records
// nothing, and the handler writes to the writer the request came with.
func TestWithServerSpan_unsampledRequest(t *testing.T) {
	provider, exporter := spanProvider(sdktrace.NeverSample())
	rec := httptest.NewRecorder()
	handler := middleware.WithServerSpan(provider)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Same(t, rec, w, "the writer is not wrapped")
		span, ok := middleware.ServerSpan(r.Context())
		require.True(t, ok)
		assert.False(t, span.IsRecording())
		assert.True(t, span.SpanContext().IsValid())
		assert.False(t, span.SpanContext().IsSampled())
		w.WriteHeader(http.StatusTeapot)
	}))

	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	assert.Equal(t, http.StatusTeapot, rec.Code)
	assert.Empty(t, exporter.GetSpans())
}

// A panic keeps propagating, and the span still ends: as an error, with the
// status the client saw, if it saw one.
func TestWithServerSpan_panickingHandler(t *testing.T) {
	for _, tt := range []struct {
		name      string
		handler   http.HandlerFunc
		wantAttrs []attribute.KeyValue
	}{
		{
			name: "after the response started",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusCreated)
				panic(http.ErrAbortHandler)
			},
			wantAttrs: []attribute.KeyValue{
				attribute.String("http.request.method", "GET"),
				attribute.Int("http.response.status_code", http.StatusCreated),
			},
		},
		{
			name:      "before any response",
			handler:   func(http.ResponseWriter, *http.Request) { panic(http.ErrAbortHandler) },
			wantAttrs: []attribute.KeyValue{attribute.String("http.request.method", "GET")},
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			provider, exporter := spanProvider(sdktrace.AlwaysSample())
			handler := middleware.WithServerSpan(provider)(tt.handler)

			require.PanicsWithValue(t, http.ErrAbortHandler, func() {
				handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
			})

			spans := exporter.GetSpans()
			require.Len(t, spans, 1)
			assert.Equal(t, tt.wantAttrs, spans[0].Attributes)
			assert.Equal(t, sdktrace.Status{Code: codes.Error}, spans[0].Status)
		})
	}
}

// Streaming works through the span's writer: a flush reaches the client.
func TestWithServerSpan_flushes(t *testing.T) {
	provider, _ := spanProvider(sdktrace.AlwaysSample())
	rec := httptest.NewRecorder()
	handler := middleware.WithServerSpan(provider)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		require.NoError(t, http.NewResponseController(w).Flush())
	}))

	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	assert.True(t, rec.Flushed)
}
