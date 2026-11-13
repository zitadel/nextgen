package api

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
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

// Behind WithServerSpan an operation gets the request's server span instead
// of one of its own, so the request has one. The span takes the operation's
// name and the attributes ogen starts a span with, keeps of an error its type
// alone, and stays open when ogen's handler ends it: the middleware ends it.
func TestOgenTracerProvider_usesTheRequestsServerSpan(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	sdk := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	ogen := NewOgenTracerProvider(sdk).Tracer("ogen")
	notFound := domain.ErrUserNotFound()

	handler := middleware.WithServerSpan(sdk)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		request := trace.SpanContextFromContext(r.Context())
		ctx, span := ogen.Start(r.Context(), "PatchUserByID",
			trace.WithSpanKind(trace.SpanKindServer),
			trace.WithAttributes(attribute.String("http.route", "/users/{user_id}")),
		)
		assert.Equal(t, request, span.SpanContext())
		assert.Equal(t, request, trace.SpanContextFromContext(ctx))

		span.RecordError(fmt.Errorf("x@y: %w", notFound))
		span.SetStatus(codes.Error, http.StatusText(http.StatusNotFound))
		w.WriteHeader(http.StatusNotFound)
		span.End()
		assert.Empty(t, exporter.GetSpans(), "the operation's End must leave the request's span open")
	}))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPatch, "/users/user_1", nil))

	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	assert.Equal(t, "PatchUserByID", spans[0].Name)
	assert.Equal(t, trace.SpanKindServer, spans[0].SpanKind)
	assert.Empty(t, spans[0].Events, "the message would carry user values")
	assert.Equal(t, sdktrace.Status{}, spans[0].Status, "a 4xx leaves the status unset")
	assert.Equal(t, []attribute.KeyValue{
		attribute.String("http.request.method", "PATCH"),
		attribute.String("http.route", "/users/{user_id}"),
		attribute.String("error.type", notFound.Code),
		attribute.Int("http.response.status_code", http.StatusNotFound),
	}, spans[0].Attributes)
}

// Only a Server span is the request's: what ogen starts with another kind is
// a span of its own, below it.
func TestOgenTracerProvider_startsASpanOfAnotherKind(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	sdk := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	ogen := NewOgenTracerProvider(sdk).Tracer("ogen")

	handler := middleware.WithServerSpan(sdk)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		_, span := ogen.Start(r.Context(), "call", trace.WithSpanKind(trace.SpanKindClient))
		span.End()
	}))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))

	spans := exporter.GetSpans()
	require.Len(t, spans, 2)
	assert.Equal(t, "call", spans[0].Name)
	assert.Equal(t, "GET", spans[1].Name)
	assert.Equal(t, spans[1].SpanContext, spans[0].Parent)
}

// A request the sampler dropped stays one span that records nothing: the
// operation gets it back and starts none.
func TestOgenTracerProvider_unsampledRequest(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	sdk := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter), sdktrace.WithSampler(sdktrace.NeverSample()))
	ogen := NewOgenTracerProvider(sdk).Tracer("ogen")

	handler := middleware.WithServerSpan(sdk)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		_, span := ogen.Start(r.Context(), "PatchUserByID", trace.WithSpanKind(trace.SpanKindServer))
		assert.False(t, span.IsRecording())
		assert.Equal(t, trace.SpanContextFromContext(r.Context()), span.SpanContext(), "no second span")
		span.End()
	}))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPatch, "/users/user_1", nil))

	assert.Empty(t, exporter.GetSpans())
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
