package api

import (
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

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
