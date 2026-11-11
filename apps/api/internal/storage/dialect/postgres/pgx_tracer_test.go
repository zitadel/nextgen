package postgres

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/zitadel/nextgen/internal/instrumentation/zotel"
)

// spanExporter is set as the global provider once, at package init: the
// package tracer delegates to the first provider set in the process, and the
// TestMain of this package only exists under the postgres_integration tag.
var spanExporter = func() *tracetest.InMemoryExporter {
	exporter := tracetest.NewInMemoryExporter()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(
		sdktrace.WithSyncer(exporter),
		sdktrace.WithSampler(zotel.NewSampler(1.0)),
	))
	return exporter
}()

func sampledContext(t *testing.T) context.Context {
	t.Helper()
	ctx, span := otel.Tracer("test").Start(t.Context(), "request", trace.WithSpanKind(trace.SpanKindServer))
	require.True(t, span.SpanContext().IsSampled())
	t.Cleanup(func() { span.End() })
	return ctx
}

func TestPGXTracer_query(t *testing.T) {
	const query = "SELECT secret FROM users WHERE email = $1"
	tests := []struct {
		name       string
		err        error
		wantStatus sdktrace.Status
		wantAttrs  []attribute.KeyValue
	}{
		{
			name:      "success",
			wantAttrs: []attribute.KeyValue{attribute.String("db.system.name", "postgresql")},
		},
		{
			name:       "error",
			err:        &pgconn.PgError{Message: "duplicate key", Detail: "Key (email)=(x@y) already exists"},
			wantStatus: sdktrace.Status{Code: codes.Error},
			wantAttrs: []attribute.KeyValue{
				attribute.String("db.system.name", "postgresql"),
				attribute.String("error.type", "*pgconn.PgError"),
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spanExporter.Reset()
			var tr pgxTracer

			ctx := tr.TraceQueryStart(sampledContext(t), nil, pgx.TraceQueryStartData{SQL: query, Args: []any{"x@y"}})
			tr.TraceQueryEnd(ctx, nil, pgx.TraceQueryEndData{Err: tt.err})

			spans := spanExporter.GetSpans()
			require.Len(t, spans, 1)
			assert.Equal(t, "pgx.query", spans[0].Name)
			assert.Equal(t, trace.SpanKindClient, spans[0].SpanKind)
			assert.Equal(t, tt.wantAttrs, spans[0].Attributes)
			assert.Equal(t, tt.wantStatus, spans[0].Status)
			assert.Empty(t, spans[0].Events)
			for _, attr := range spans[0].Attributes {
				assert.NotContains(t, attr.Value.String(), "SELECT")
				assert.NotContains(t, attr.Value.String(), "x@y")
			}
		})
	}
}

func TestPGXTracer_acquire(t *testing.T) {
	spanExporter.Reset()
	var tr pgxTracer

	ctx := tr.TraceAcquireStart(sampledContext(t), nil, pgxpool.TraceAcquireStartData{})
	tr.TraceAcquireEnd(ctx, nil, pgxpool.TraceAcquireEndData{Err: context.DeadlineExceeded})

	spans := spanExporter.GetSpans()
	require.Len(t, spans, 1)
	assert.Equal(t, "pgx.acquire", spans[0].Name)
	assert.Equal(t, trace.SpanKindInternal, spans[0].SpanKind)
	assert.Equal(t, []attribute.KeyValue{
		attribute.String("db.system.name", "postgresql"),
		attribute.String("error.type", "context.deadlineExceededError"),
	}, spans[0].Attributes)
	assert.Equal(t, sdktrace.Status{Code: codes.Error}, spans[0].Status)
}

func TestPGXTracer_parentNotSampled(t *testing.T) {
	spanExporter.Reset()
	var tr pgxTracer
	ctx := t.Context()

	got := tr.TraceQueryStart(ctx, nil, pgx.TraceQueryStartData{SQL: "SELECT 1"})
	tr.TraceQueryEnd(got, nil, pgx.TraceQueryEndData{})
	assert.Equal(t, ctx, got, "no span may be started")

	got = tr.TraceAcquireStart(ctx, nil, pgxpool.TraceAcquireStartData{})
	tr.TraceAcquireEnd(got, nil, pgxpool.TraceAcquireEndData{})
	assert.Equal(t, ctx, got, "no span may be started")

	assert.Empty(t, spanExporter.GetSpans())
}
