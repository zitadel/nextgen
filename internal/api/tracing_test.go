package api

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestOgenTracerProvider_RecordError(t *testing.T) {
	notFound := domain.ErrUserNotFound()
	for _, tt := range []struct {
		name  string
		err   error
		attrs []attribute.KeyValue
	}{
		{name: "domain error gives its code", err: fmt.Errorf("x@y: %w", notFound), attrs: []attribute.KeyValue{attribute.String("error.type", notFound.Code)}},
		{name: "plain error gives its type", err: errors.New("x@y"), attrs: []attribute.KeyValue{attribute.String("error.type", "*errors.errorString")}},
		{name: "nil error records nothing"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter()
			provider := NewOgenTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter)))

			_, span := provider.Tracer("ogen").Start(t.Context(), "PatchUserByID")
			span.RecordError(tt.err)
			span.End()

			spans := exporter.GetSpans()
			require.Len(t, spans, 1)
			assert.Empty(t, spans[0].Events, "the message would carry user values")
			assert.Equal(t, tt.attrs, spans[0].Attributes)
		})
	}
}

// The server span context goes into the holder when ogen starts the span,
// before security and decoding run, so a request that fails decoding is still
// linked to its server span. Only a Server span is stored, sampled or not.
func TestOgenTracerProvider_storesServerSpanContext(t *testing.T) {
	for _, tt := range []struct {
		name      string
		kind      trace.SpanKind
		sampler   sdktrace.Sampler
		wantStore bool
	}{
		{name: "sampled server span", kind: trace.SpanKindServer, sampler: sdktrace.AlwaysSample(), wantStore: true},
		{name: "unsampled server span", kind: trace.SpanKindServer, sampler: sdktrace.NeverSample(), wantStore: true},
		{name: "client span", kind: trace.SpanKindClient, sampler: sdktrace.AlwaysSample()},
	} {
		t.Run(tt.name, func(t *testing.T) {
			provider := NewOgenTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSampler(tt.sampler)))
			ctx := middleware.WithOperationIDContext(t.Context(), "")

			_, span := provider.Tracer("ogen").Start(ctx, "PatchUserByID", trace.WithSpanKind(tt.kind))
			defer span.End()

			want := trace.SpanContext{}
			if tt.wantStore {
				want = span.SpanContext()
			}
			assert.Equal(t, want, middleware.GetServerSpanContext(ctx))
		})
	}
}

// ogen's response encoders set Error with the status text on a typed 4xx
// response. HTTP server semantic conventions leave a 4xx Unset, as
// OgenErrorHandler does, so only that Error is dropped.
func TestOgenTracerProvider_SetStatus(t *testing.T) {
	for _, tt := range []struct {
		name        string
		code        codes.Code
		description string
		want        sdktrace.Status
	}{
		{name: "4xx status text is dropped", code: codes.Error, description: http.StatusText(http.StatusBadRequest)},
		{name: "another 4xx status text is dropped", code: codes.Error, description: http.StatusText(http.StatusNotFound)},
		{name: "5xx status text stays", code: codes.Error, description: http.StatusText(http.StatusInternalServerError), want: sdktrace.Status{Code: codes.Error, Description: http.StatusText(http.StatusInternalServerError)}},
		{name: "a failed stage stays", code: codes.Error, description: "Decode request", want: sdktrace.Status{Code: codes.Error, Description: "Decode request"}},
		{name: "ok stays", code: codes.Ok, description: http.StatusText(http.StatusOK), want: sdktrace.Status{Code: codes.Ok}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter()
			provider := NewOgenTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter)))

			_, span := provider.Tracer("ogen").Start(t.Context(), "PatchUserByID", trace.WithSpanKind(trace.SpanKindServer))
			span.SetStatus(tt.code, tt.description)
			span.End()

			spans := exporter.GetSpans()
			require.Len(t, spans, 1)
			assert.Equal(t, tt.want, spans[0].Status)
		})
	}
}
