package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.39.0"
	"go.opentelemetry.io/otel/trace"

	"github.com/zitadel/nextgen/internal/api/middleware"
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
	if cfg := trace.NewSpanStartConfig(opts...); cfg.SpanKind() == trace.SpanKindServer {
		middleware.SetServerSpanContext(ctx, span.SpanContext())
	}
	if !span.IsRecording() {
		return ctx, span
	}
	return ctx, ogenSpan{span}
}

type ogenSpan struct{ trace.Span }

// clientErrorTexts are the status texts of the 4xx codes.
var clientErrorTexts = func() map[string]bool {
	texts := map[string]bool{}
	for code := 400; code < 500; code++ {
		if text := http.StatusText(code); text != "" {
			texts[text] = true
		}
	}
	return texts
}()

// SetStatus drops the Error status ogen's response encoders set, with the
// status text as description, for a typed 4xx response. HTTP server semantic
// conventions leave a 4xx Unset on a server span, as a 4xx answered through
// OgenErrorHandler already is. Everything else passes through, such as the
// Error with a stage name ogen sets when a request fails.
func (s ogenSpan) SetStatus(code codes.Code, description string) {
	if code == codes.Error && clientErrorTexts[description] {
		return
	}
	s.Span.SetStatus(code, description)
}

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
