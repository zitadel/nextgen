package api

import (
	"context"
	"errors"
	"fmt"

	semconv "go.opentelemetry.io/otel/semconv/v1.39.0"
	"go.opentelemetry.io/otel/trace"

	"github.com/zitadel/nextgen/internal/domain"
)

// NewOgenTracerProvider wraps the provider of the ogen server. ogen records
// every failed request with RecordError, which stores the error message as a
// span event, and messages can carry user values (a database error quoting
// the duplicate value, for one). On the spans it starts, RecordError keeps
// only the error type: the domain code, or else the Go type. Everything else
// passes through.
func NewOgenTracerProvider(provider trace.TracerProvider) trace.TracerProvider {
	return ogenTracerProvider{provider}
}

type ogenTracerProvider struct{ trace.TracerProvider }

func (p ogenTracerProvider) Tracer(name string, opts ...trace.TracerOption) trace.Tracer {
	return ogenTracer{p.TracerProvider.Tracer(name, opts...)}
}

type ogenTracer struct{ trace.Tracer }

func (t ogenTracer) Start(ctx context.Context, name string, opts ...trace.SpanStartOption) (context.Context, trace.Span) {
	ctx, span := t.Tracer.Start(ctx, name, opts...)
	if !span.IsRecording() {
		return ctx, span
	}
	return ctx, ogenSpan{span}
}

type ogenSpan struct{ trace.Span }

func (s ogenSpan) RecordError(err error, _ ...trace.EventOption) {
	if err == nil {
		return
	}
	errType := fmt.Sprintf("%T", err)
	if de, ok := errors.AsType[domain.Error](err); ok {
		errType = de.Code
	}
	s.SetAttributes(semconv.ErrorTypeKey.String(errType))
}
