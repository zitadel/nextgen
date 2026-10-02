package zotel_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	tracesdk "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"

	"github.com/zitadel/nextgen/internal/instrumentation/zotel"
)

func TestNewSampler_links(t *testing.T) {
	link := func(flags trace.TraceFlags) trace.Link {
		return trace.Link{SpanContext: trace.NewSpanContext(trace.SpanContextConfig{
			TraceID:    trace.TraceID{1},
			SpanID:     trace.SpanID{1},
			TraceFlags: flags,
		})}
	}
	sampled, unsampled := link(trace.FlagsSampled), link(0)

	for _, tt := range []struct {
		name   string
		parent trace.SpanContext
		kind   trace.SpanKind
		links  []trace.Link
		want   tracesdk.SamplingDecision
	}{
		{name: "server root is sampled", kind: trace.SpanKindServer, want: tracesdk.RecordAndSample},
		{name: "consumer root with a sampled link is sampled", kind: trace.SpanKindConsumer, links: []trace.Link{unsampled, sampled}, want: tracesdk.RecordAndSample},
		{name: "consumer root without a sampled link is dropped", kind: trace.SpanKindConsumer, links: []trace.Link{unsampled}, want: tracesdk.Drop},
		{name: "consumer root without links is dropped", kind: trace.SpanKindConsumer, want: tracesdk.Drop},
		{name: "internal root is dropped even with a sampled link", kind: trace.SpanKindInternal, links: []trace.Link{sampled}, want: tracesdk.Drop},
		{name: "consumer child of an unsampled parent is dropped even with a sampled link", parent: unsampled.SpanContext, kind: trace.SpanKindConsumer, links: []trace.Link{sampled}, want: tracesdk.Drop},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := zotel.NewSampler(1.0).ShouldSample(tracesdk.SamplingParameters{
				ParentContext: trace.ContextWithSpanContext(t.Context(), tt.parent),
				TraceID:       trace.TraceID{2},
				Name:          "root",
				Kind:          tt.kind,
				Links:         tt.links,
			})
			assert.Equal(t, tt.want, got.Decision)
		})
	}
}
