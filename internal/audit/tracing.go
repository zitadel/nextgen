package audit

import (
	"context"
	"fmt"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.39.0"
	"go.opentelemetry.io/otel/trace"
)

var tracer = otel.Tracer("github.com/zitadel/nextgen/internal/audit")

// startJobSpan starts the root span of one run of a background job. A job has
// no request to inherit a trace from, so without it the service and database
// spans of the run would never be recorded. The sampler samples an Internal
// root at the trace ratio, as it does a request's server span; the kind is set
// explicitly because the sampler sees an unset kind as unspecified.
func startJobSpan(name string) (context.Context, trace.Span) {
	return tracer.Start(context.Background(), name, trace.WithSpanKind(trace.SpanKindInternal))
}

// failJobSpan marks the job span in ctx failed. Only the Go type of err goes on
// the span: the message can carry user values.
func failJobSpan(ctx context.Context, err error) {
	span := trace.SpanFromContext(ctx)
	span.SetStatus(codes.Error, "")
	span.SetAttributes(semconv.ErrorTypeKey.String(fmt.Sprintf("%T", err)))
}
