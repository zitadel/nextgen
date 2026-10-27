package audit

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
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

// rootSpans returns the exported root spans named name.
func rootSpans(name string) []tracetest.SpanStub {
	var found []tracetest.SpanStub
	for _, s := range spanExporter.GetSpans() {
		if s.Name == name && !s.Parent.IsValid() {
			found = append(found, s)
		}
	}
	return found
}

// jobSpan returns the one exported root span named name, which must be sampled.
func jobSpan(t *testing.T, name string) tracetest.SpanStub {
	t.Helper()
	found := rootSpans(name)
	require.Len(t, found, 1, "one root named %s", name)
	assert.True(t, found[0].SpanContext.IsSampled())
	return found[0]
}

type tracedPurger struct {
	err  error
	seen trace.SpanContext
}

func (p *tracedPurger) DeleteEventsOlderThan(ctx context.Context, _ time.Time) (int64, error) {
	p.seen = trace.SpanContextFromContext(ctx)
	return 0, p.err
}

func TestRetentionJob_runIsTraced(t *testing.T) {
	for _, tt := range []struct {
		name       string
		err        error
		wantStatus codes.Code
		wantAttrs  []attribute.KeyValue
	}{
		{name: "success", wantAttrs: []attribute.KeyValue{zotel.JobRoot}},
		{name: "failure", err: errors.New("x@y"), wantStatus: codes.Error, wantAttrs: []attribute.KeyValue{zotel.JobRoot, attribute.String("error.type", "*errors.errorString")}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			spanExporter.Reset()
			p := &tracedPurger{err: tt.err}
			NewRetentionJob(p, RetentionConfig{Retention: time.Hour, Interval: time.Hour, Enabled: true}).runOnce()

			span := jobSpan(t, "audit.PurgeExpiredEvents")
			assert.Equal(t, span.SpanContext, p.seen, "the purge runs under the job span")
			assert.Equal(t, sdktrace.Status{Code: tt.wantStatus}, span.Status)
			assert.Equal(t, tt.wantAttrs, span.Attributes)
		})
	}
}

// A run that a request starts is a job root like the loop's, sampled by the
// job rule, even when the request carries a caller's trace context
// (instrumentation.trace.trust_remote_spans).
func TestRetentionJob_triggeredRunIsTraced(t *testing.T) {
	spanExporter.Reset()
	p := &tracedPurger{}
	trigger := NewRetentionJob(p, RetentionConfig{Retention: time.Hour, Enabled: true, TriggerSecret: testTriggerSecret}).Trigger()
	caller := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    trace.TraceID{1},
		SpanID:     trace.SpanID{1},
		TraceFlags: trace.FlagsSampled,
		Remote:     true,
	})
	r := httptest.NewRequestWithContext(trace.ContextWithRemoteSpanContext(t.Context(), caller), http.MethodGet, RetentionTriggerPath, nil)
	r.Header.Set("Authorization", "Bearer "+testTriggerSecret)

	trigger.ServeHTTP(httptest.NewRecorder(), r)

	span := jobSpan(t, "audit.PurgeExpiredEvents")
	assert.Equal(t, span.SpanContext, p.seen, "the purge runs under the job span")
	assert.NotEqual(t, caller.TraceID(), span.SpanContext.TraceID(), "the run does not join the caller's trace")
	assert.Equal(t, []attribute.KeyValue{zotel.JobRoot}, span.Attributes)
}

// tracedExportSource records the span each call runs under, and fails a call
// when its error is set.
type tracedExportSource struct {
	*fakeExportSource
	list     trace.SpanContext
	projects map[string]trace.SpanContext

	listErr, cursorErr, afterErr, upsertErr error
}

func (s *tracedExportSource) ListClaimedProjectIDs(ctx context.Context) ([]string, error) {
	s.list = trace.SpanContextFromContext(ctx)
	if s.listErr != nil {
		return nil, s.listErr
	}
	return s.fakeExportSource.ListClaimedProjectIDs(ctx)
}

func (s *tracedExportSource) GetEventSinkCursor(ctx context.Context, sinkID, projectID string) (*domain.EventSinkCursor, error) {
	s.projects[projectID] = trace.SpanContextFromContext(ctx)
	if s.cursorErr != nil {
		return nil, s.cursorErr
	}
	return s.fakeExportSource.GetEventSinkCursor(ctx, sinkID, projectID)
}

func (s *tracedExportSource) ListEventsAfterCursor(ctx context.Context, projectID string, afterCreatedAt time.Time, afterID string, limit int) ([]*domain.Event, error) {
	if s.afterErr != nil {
		return nil, s.afterErr
	}
	return s.fakeExportSource.ListEventsAfterCursor(ctx, projectID, afterCreatedAt, afterID, limit)
}

func (s *tracedExportSource) UpsertEventSinkCursor(ctx context.Context, cursor *domain.EventSinkCursor) error {
	if s.upsertErr != nil {
		return s.upsertErr
	}
	return s.fakeExportSource.UpsertEventSinkCursor(ctx, cursor)
}

// Every failure of a step fails the span it runs under: the list span for the
// project list, the root of the (sink, project) pair for the rest.
func TestShipper_failedStepFailsItsSpan(t *testing.T) {
	failed := errors.New("x@y")
	for _, tt := range []struct {
		name     string
		src      tracedExportSource
		wantSpan string
	}{
		{name: "project list", src: tracedExportSource{listErr: failed}, wantSpan: "audit.ListClaimedProjects"},
		{name: "cursor read", src: tracedExportSource{cursorErr: failed}, wantSpan: "audit.ShipEvents"},
		{name: "event list", src: tracedExportSource{afterErr: failed}, wantSpan: "audit.ShipEvents"},
		{name: "cursor write", src: tracedExportSource{upsertErr: failed}, wantSpan: "audit.ShipEvents"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			spanExporter.Reset()
			src := tt.src
			src.fakeExportSource = newFakeExportSource([]string{"proj_a"}, map[string][]*domain.Event{
				"proj_a": {{ProjectID: "proj_a", ID: "evt_1", CreatedAt: time.Now(), EventType: domain.EventTypeUserCreated, Category: domain.EventCategoryEntity}},
			})
			src.projects = map[string]trace.SpanContext{}
			s := NewShipper(&src, ExportConfig{Enabled: true, Interval: time.Hour})
			s.sinks = []*domain.EventSink{{ID: "sink_stdout", Type: domain.EventSinkTypeStdout, Enabled: true}}

			s.shipOnce()

			span := jobSpan(t, tt.wantSpan)
			assert.Equal(t, codes.Error, span.Status.Code)
			assert.Contains(t, span.Attributes, attribute.String("error.type", "*errors.errorString"))
		})
	}
}

// A tick lists the projects under a short span of its own, and ships each
// project to each sink under its own root, so one trace stays small however
// many projects there are.
func TestShipper_runIsTraced(t *testing.T) {
	spanExporter.Reset()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	src := &tracedExportSource{
		fakeExportSource: newFakeExportSource([]string{"proj_a", "proj_b"}, map[string][]*domain.Event{
			"proj_b": {{ProjectID: "proj_b", ID: "evt_1", CreatedAt: t0, EventType: domain.EventTypeUserCreated, Category: domain.EventCategoryEntity}},
		}),
		projects: map[string]trace.SpanContext{},
	}
	s := NewShipper(src, ExportConfig{Enabled: true, Interval: time.Hour})
	// The sink type is unknown to deliver, so delivering proj_b's event fails.
	s.sinks = []*domain.EventSink{{ID: "sink_x", Type: "unknown", Enabled: true}}

	s.shipOnce()

	list := jobSpan(t, "audit.ListClaimedProjects")
	assert.Equal(t, list.SpanContext, src.list, "the project list runs under the list span")

	ships := rootSpans("audit.ShipEvents")
	require.Len(t, ships, 2, "one root per sink and project")
	for _, span := range ships {
		attrs := attribute.NewSet(span.Attributes...)
		project, _ := attrs.Value("zitadel.project.id")
		sink, _ := attrs.Value("zitadel.event_sink.id")
		assert.Equal(t, "sink_x", sink.AsString())
		assert.True(t, attrs.HasValue(zotel.JobRoot.Key))
		assert.True(t, span.SpanContext.IsSampled())
		assert.Equal(t, span.SpanContext, src.projects[project.AsString()], "the project is shipped under its own root")
		wantStatus := codes.Unset
		if project.AsString() == "proj_b" {
			wantStatus = codes.Error
		}
		assert.Equal(t, wantStatus, span.Status.Code, "a failed delivery fails the root of %s", project.AsString())
	}
}

// Without sinks there is nothing to ship, so no loop runs and no project list
// is read every interval.
func TestShipper_StartWithoutSinksRunsNoLoop(t *testing.T) {
	s := NewShipper(newFakeExportSource([]string{"proj_a"}, nil), ExportConfig{Enabled: true, Interval: time.Millisecond})
	require.NoError(t, s.Start(t.Context()))
	t.Cleanup(s.Close)

	select {
	case <-s.done:
	default:
		t.Fatal("the shipper started a loop without sinks")
	}
}

// serveTracedRequest sends one request through the audit middleware the way
// the server does: the logging middleware plants the operation ID holder
// outside it, and the ogen tracer stores the server span context in it when it
// starts that span. A sampled request gets a real server span; an unsampled
// one carries a span context that is valid but not sampled. The whole chain of
// the server is covered in cmd/server.
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
		middleware.SetServerSpanContext(ctx, server)
		ac, ok := ActorSlotFromContext(ctx)
		require.True(t, ok)
		ac.ProjectID = "proj_1"
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
