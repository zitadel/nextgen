package zotel_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"go.opentelemetry.io/otel/attribute"
	tracesdk "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"

	"github.com/zitadel/nextgen/internal/instrumentation/zotel"
)

// Libraries such as the Spanner client start their own root spans from
// background work. Only a job root that carries zotel.JobRoot may start a
// trace next to a request.
func TestNewSampler_jobRoots(t *testing.T) {
	for _, tt := range []struct {
		name  string
		kind  trace.SpanKind
		attrs []attribute.KeyValue
		want  tracesdk.SamplingDecision
	}{
		{name: "server root is sampled", kind: trace.SpanKindServer, want: tracesdk.RecordAndSample},
		{name: "job root is sampled", kind: trace.SpanKindInternal, attrs: []attribute.KeyValue{zotel.JobRoot}, want: tracesdk.RecordAndSample},
		{name: "internal root without the job marker is dropped", kind: trace.SpanKindInternal, want: tracesdk.Drop},
		{name: "kindless root is dropped", kind: trace.SpanKindUnspecified, want: tracesdk.Drop},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := zotel.NewSampler(1.0).ShouldSample(tracesdk.SamplingParameters{
				ParentContext: t.Context(),
				TraceID:       trace.TraceID{2},
				Name:          "root",
				Kind:          tt.kind,
				Attributes:    tt.attrs,
			})
			assert.Equal(t, tt.want, got.Decision)
		})
	}
}
