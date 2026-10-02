package service

import (
	"errors"
	"fmt"
	"testing"

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

// spanExporter sets the global provider once, when the test binary starts:
// the package tracer delegates to the first provider set in the process. It
// is a package variable, not a TestMain, because the postgres_integration
// build already has a TestMain in this test binary.
var spanExporter = func() *tracetest.InMemoryExporter {
	exporter := tracetest.NewInMemoryExporter()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(
		sdktrace.WithSyncer(exporter),
		sdktrace.WithSampler(zotel.NewSampler(1.0)),
	))
	return exporter
}()

func TestStartSpan(t *testing.T) {
	clientErr := domain.ErrAuthAttemptNotFound()
	internalErr := domain.ErrInternal(errors.New("x@y"))
	unavailableErr := domain.ErrUnavailable()
	for _, tt := range []struct {
		name       string
		err        error
		wantType   string
		wantStatus codes.Code
	}{
		{name: "nil error", err: nil},
		{name: "domain client error gives its code and no error status", err: fmt.Errorf("lookup: %w", clientErr), wantType: clientErr.Code},
		{name: "internal domain error is a failure", err: fmt.Errorf("lookup: %w", internalErr), wantType: internalErr.Code, wantStatus: codes.Error},
		{name: "unavailable domain error is a failure", err: unavailableErr, wantType: unavailableErr.Code, wantStatus: codes.Error},
		{name: "plain error gives its type and is a failure", err: errors.New("x@y"), wantType: "*errors.errorString", wantStatus: codes.Error},
	} {
		t.Run(tt.name, func(t *testing.T) {
			spanExporter.Reset()
			parent, root := otel.Tracer("test").Start(t.Context(), "request", trace.WithSpanKind(trace.SpanKindServer))
			require.True(t, root.SpanContext().IsSampled())

			ctx, end := startSpan(parent, "UserService.CreateUser")
			assert.NotEqual(t, root.SpanContext(), trace.SpanContextFromContext(ctx), "the returned ctx carries the new span")
			err := tt.err
			end(&err)
			root.End()

			spans := spanExporter.GetSpans()
			require.Len(t, spans, 2)
			span := spans[0]
			assert.Equal(t, "UserService.CreateUser", span.Name)
			assert.Equal(t, root.SpanContext().SpanID(), span.Parent.SpanID())
			assert.Empty(t, span.Events)
			// The message carries user values, so only the code or type goes on the span.
			assert.Equal(t, sdktrace.Status{Code: tt.wantStatus}, span.Status)
			if tt.wantType == "" {
				assert.Empty(t, span.Attributes)
				return
			}
			assert.Equal(t, []attribute.KeyValue{attribute.String("error.type", tt.wantType)}, span.Attributes)
		})
	}
}

func TestStartSpan_parentNotSampled(t *testing.T) {
	spanExporter.Reset()
	ctx := trace.ContextWithSpanContext(t.Context(), trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: trace.TraceID{1},
		SpanID:  trace.SpanID{1},
	}))
	require.True(t, trace.SpanContextFromContext(ctx).IsValid())

	got, end := startSpan(ctx, "UserService.CreateUser")
	err := errors.New("boom")
	end(&err)

	assert.Equal(t, ctx, got, "no span may be started")
	assert.Empty(t, spanExporter.GetSpans())
}
