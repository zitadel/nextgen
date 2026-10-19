package audit

import (
	"context"
	"errors"
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

// jobSpan returns the one exported span named name, which must be a root.
func jobSpan(t *testing.T, name string) tracetest.SpanStub {
	t.Helper()
	var found []tracetest.SpanStub
	for _, s := range spanExporter.GetSpans() {
		if s.Name == name {
			found = append(found, s)
		}
	}
	require.Len(t, found, 1)
	assert.False(t, found[0].Parent.IsValid(), "a job run is a root")
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

type tracedExportSource struct {
	*fakeExportSource
	list     trace.SpanContext
	projects map[string]trace.SpanContext
}

func (s *tracedExportSource) ListClaimedProjectIDs(ctx context.Context) ([]string, error) {
	s.list = trace.SpanContextFromContext(ctx)
	return s.fakeExportSource.ListClaimedProjectIDs(ctx)
}

func (s *tracedExportSource) GetEventSinkCursor(ctx context.Context, sinkID, projectID string) (*domain.EventSinkCursor, error) {
	s.projects[projectID] = trace.SpanContextFromContext(ctx)
	return s.fakeExportSource.GetEventSinkCursor(ctx, sinkID, projectID)
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
