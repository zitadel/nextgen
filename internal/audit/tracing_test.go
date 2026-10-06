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
		{name: "success"},
		{name: "failure", err: errors.New("x@y"), wantStatus: codes.Error, wantAttrs: []attribute.KeyValue{attribute.String("error.type", "*errors.errorString")}},
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
	list, project trace.SpanContext
}

func (s *tracedExportSource) ListClaimedProjectIDs(ctx context.Context) ([]string, error) {
	s.list = trace.SpanContextFromContext(ctx)
	return s.fakeExportSource.ListClaimedProjectIDs(ctx)
}

func (s *tracedExportSource) GetEventSinkCursor(ctx context.Context, sinkID, projectID string) (*domain.EventSinkCursor, error) {
	s.project = trace.SpanContextFromContext(ctx)
	return s.fakeExportSource.GetEventSinkCursor(ctx, sinkID, projectID)
}

func TestShipper_runIsTraced(t *testing.T) {
	spanExporter.Reset()
	src := &tracedExportSource{fakeExportSource: newFakeExportSource([]string{"proj_a"}, nil)}
	s := NewShipper(src, ExportConfig{Enabled: true, Interval: time.Hour})
	s.sinks = []*domain.EventSink{{ID: "sink_stdout", Type: domain.EventSinkTypeStdout, Enabled: true}}

	s.shipOnce()

	span := jobSpan(t, "audit.ShipEvents")
	assert.Equal(t, span.SpanContext, src.list, "the project list runs under the job span")
	assert.Equal(t, span.SpanContext, src.project, "each project is shipped under the job span")
}
