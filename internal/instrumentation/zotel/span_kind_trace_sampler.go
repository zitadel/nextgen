package zotel

import (
	"fmt"
	"slices"

	tracesdk "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

type spanKindSampler struct {
	sampler tracesdk.Sampler
	kinds   []trace.SpanKind
}

// ShouldSample implements the [sdk_trace.Sampler] interface.
// It will not sample any spans which do not match the configured span kinds.
// For spans which do match, the decorated sampler is used to make the sampling decision.
// A Consumer span linked to at least one sampled span is always sampled, so
// work done later for a sampled request (an audit flush) stays in the trace.
func (sk spanKindSampler) ShouldSample(p tracesdk.SamplingParameters) tracesdk.SamplingResult {
	psc := trace.SpanContextFromContext(p.ParentContext)
	if p.Kind == trace.SpanKindConsumer && slices.ContainsFunc(p.Links, func(l trace.Link) bool { return l.SpanContext.IsSampled() }) {
		return tracesdk.SamplingResult{
			Decision:   tracesdk.RecordAndSample,
			Tracestate: psc.TraceState(),
		}
	}
	if !slices.Contains(sk.kinds, p.Kind) {
		return tracesdk.SamplingResult{
			Decision:   tracesdk.Drop,
			Tracestate: psc.TraceState(),
		}
	}
	s := sk.sampler.ShouldSample(p)
	return s
}

func (sk spanKindSampler) Description() string {
	return fmt.Sprintf("SpanKindBased{sampler:%s,kinds:%v}",
		sk.sampler.Description(),
		sk.kinds,
	)
}

// spanKindBased returns a sampler decorator which behaves differently, based on the kind of the span.
// If the span kind does not match one of the configured kinds, it will not be sampled.
// If the span kind matches, the decorated sampler is used to make sampling decision.
func spanKindBased(sampler tracesdk.Sampler, kinds ...trace.SpanKind) tracesdk.Sampler {
	return spanKindSampler{
		sampler: sampler,
		kinds:   kinds,
	}
}
