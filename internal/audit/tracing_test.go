package audit

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	ogenmiddleware "github.com/ogen-go/ogen/middleware"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/instrumentation/zotel"
)

var spanExporter = tracetest.NewInMemoryExporter()

// TestMain sets the global provider once: the package tracer delegates to the
// first provider set in the process.
func TestMain(m *testing.M) {
	otel.SetTracerProvider(sdktrace.NewTracerProvider(
		sdktrace.WithSyncer(spanExporter),
		sdktrace.WithSampler(zotel.NewSampler(1.0)),
	))
	os.Exit(m.Run())
}

// serveTracedRequest sends one request through the audit middleware the way
// the server does: the logging middleware plants the operation ID holder
// outside it, and the ogen middleware fills the holder inside the server span.
// A sampled request gets a real server span; an unsampled one carries a span
// context that is valid but not sampled.
func serveTracedRequest(t *testing.T, buf *RequestBuffer, sampled bool) trace.SpanContext {
	t.Helper()
	var server trace.SpanContext
	h := WithRequestEventMiddleware(buf, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := trace.ContextWithSpanContext(r.Context(), trace.NewSpanContext(trace.SpanContextConfig{
			TraceID: trace.TraceID{1},
			SpanID:  trace.SpanID{1},
		}))
		if sampled {
			var span trace.Span
			ctx, span = otel.Tracer("test").Start(r.Context(), "server", trace.WithSpanKind(trace.SpanKindServer))
			defer span.End()
		}
		server = trace.SpanContextFromContext(ctx)
		_, err := middleware.AddOperationIdToContext()(ogenmiddleware.Request{Context: ctx, OperationID: "PatchUserByID"},
			func(req ogenmiddleware.Request) (ogenmiddleware.Response, error) {
				ac, ok := ActorSlotFromContext(req.Context)
				require.True(t, ok)
				ac.ProjectID = "proj_1"
				return ogenmiddleware.Response{}, nil
			})
		require.NoError(t, err)
		w.WriteHeader(http.StatusOK)
	}))
	r := httptest.NewRequest(http.MethodPatch, "/users/u1", nil)
	h.ServeHTTP(httptest.NewRecorder(), r.WithContext(middleware.WithOperationIDContext(r.Context(), "")))
	return server
}

func newTracedBuffer(t *testing.T) (*channelInserter, *RequestBuffer) {
	t.Helper()
	ins := &channelInserter{}
	buf := NewRequestBuffer(ins, RequestBufferConfig{BatchSize: 100, Capacity: 100, MaxAge: time.Hour})
	t.Cleanup(buf.Close)
	return ins, buf
}

func TestRequestEvent_sampledRequestIsTraced(t *testing.T) {
	spanExporter.Reset()
	ins, buf := newTracedBuffer(t)

	server := serveTracedRequest(t, buf, true)
	buf.Close() // flushes and waits for the flusher to return
	require.Equal(t, 1, ins.count())

	spans := map[string]tracetest.SpanStub{}
	for _, s := range spanExporter.GetSpans() {
		spans[s.Name] = s
	}
	require.Len(t, spans, 3, "server, enqueue and flush")

	enqueue := spans["audit.EnqueueRequestEvent"]
	assert.Equal(t, server, enqueue.Parent, "the enqueue span is a child of the server span")

	flush := spans["audit.FlushRequestEvents"]
	assert.False(t, flush.Parent.IsValid(), "the flush span is a root")
	assert.Equal(t, trace.SpanKindConsumer, flush.SpanKind)
	require.Len(t, flush.Links, 1)
	assert.Equal(t, enqueue.SpanContext, flush.Links[0].SpanContext, "the flush links to the request it writes for")
}

func TestRequestEvent_unsampledRequestsAreNotTraced(t *testing.T) {
	spanExporter.Reset()
	ins, buf := newTracedBuffer(t)

	serveTracedRequest(t, buf, false)
	serveTracedRequest(t, buf, false)
	buf.Close()
	require.Equal(t, 2, ins.count())

	assert.Empty(t, spanExporter.GetSpans())
}
