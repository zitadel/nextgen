package postgres

import (
	"context"
	"testing"
	"time"

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
		sql        string
		err        error
		wantStatus sdktrace.Status
		wantAttrs  []attribute.KeyValue
	}{
		{
			name: "success",
			sql:  query,
			wantAttrs: []attribute.KeyValue{
				attribute.String("db.system.name", "postgresql"),
				attribute.String("db.operation.name", "SELECT"),
			},
		},
		{
			name:       "error",
			sql:        query,
			err:        &pgconn.PgError{Message: "duplicate key", Detail: "Key (email)=(x@y) already exists"},
			wantStatus: sdktrace.Status{Code: codes.Error},
			wantAttrs: []attribute.KeyValue{
				attribute.String("db.system.name", "postgresql"),
				attribute.String("db.operation.name", "SELECT"),
				attribute.String("error.type", "*pgconn.PgError"),
			},
		},
		{
			// What pgx sends for Begin, outside every statement span.
			name: "transaction begin",
			sql:  "begin",
			wantAttrs: []attribute.KeyValue{
				attribute.String("db.system.name", "postgresql"),
				attribute.String("db.operation.name", "BEGIN"),
			},
		},
		{
			name:      "no command",
			sql:       "x@y",
			wantAttrs: []attribute.KeyValue{attribute.String("db.system.name", "postgresql")},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spanExporter.Reset()
			var tr pgxTracer

			ctx := tr.TraceQueryStart(sampledContext(t), nil, pgx.TraceQueryStartData{SQL: tt.sql, Args: []any{"x@y"}})
			tr.TraceQueryEnd(ctx, nil, pgx.TraceQueryEndData{Err: tt.err})

			spans := spanExporter.GetSpans()
			require.Len(t, spans, 1)
			assert.Equal(t, "pgx.query", spans[0].Name)
			assert.Equal(t, trace.SpanKindClient, spans[0].SpanKind)
			assert.Equal(t, tt.wantAttrs, spans[0].Attributes)
			assert.Equal(t, tt.wantStatus, spans[0].Status)
			assert.Empty(t, spans[0].Events)
			for _, attr := range spans[0].Attributes {
				assert.NotContains(t, attr.Value.String(), "secret")
				assert.NotContains(t, attr.Value.String(), "x@y")
			}
		})
	}
}

// The operation name is the statement's first word and nothing else of it:
// one of the words a PostgreSQL command starts with, or empty.
func TestOperationName(t *testing.T) {
	for sql, want := range map[string]string{
		"SELECT id FROM users":                     "SELECT",
		"select*from users":                        "SELECT",
		"\n\t\tINSERT INTO users (id) VALUES ($1)": "INSERT",
		"(SELECT 1) UNION (SELECT 2)":              "SELECT",
		"WITH moved AS (DELETE FROM a RETURNING id) INSERT INTO b SELECT id FROM moved": "WITH",
		// What pgx sends for a transaction and a savepoint.
		"begin":                              "BEGIN",
		"begin isolation level serializable": "BEGIN",
		"commit":                             "COMMIT",
		"rollback":                           "ROLLBACK",
		"savepoint sp_1":                     "SAVEPOINT",
		"release savepoint sp_1":             "RELEASE",
		"rollback to savepoint sp_1":         "ROLLBACK",
		"":                                   "",
		"   ":                                "",
		"-- ping":                            "",
		"$1":                                 "",
		"SELECTED":                           "",
		"alice@example.com":                  "",
		"DEALLOCATEALLTHETHINGS":             "",
		"s\u00e9lect 1":                      "",
	} {
		assert.Equal(t, want, operationName(sql), "%q", sql)
	}
	for name := range operationNames {
		assert.Equal(t, name, operationName(name+" x"), "a listed name must fit the buffer")
	}
	// Every traced query pays for it.
	assert.Zero(t, testing.AllocsPerRun(100, func() { _ = operationName("rollback to savepoint sp_1") }))
}

// The hooks hand the start time from one to the other, and a failed acquire
// gets its span whatever it took.
func TestPGXTracer_acquire(t *testing.T) {
	spanExporter.Reset()
	var tr pgxTracer
	parent := sampledContext(t)

	ctx := tr.TraceAcquireStart(parent, nil, pgxpool.TraceAcquireStartData{})
	assert.Equal(t, trace.SpanFromContext(parent), trace.SpanFromContext(ctx), "no span may be started before the acquire ends")
	assert.Empty(t, spanExporter.GetSpans())
	tr.TraceAcquireEnd(ctx, nil, pgxpool.TraceAcquireEndData{Err: context.DeadlineExceeded})

	spans := spanExporter.GetSpans()
	require.Len(t, spans, 1)
	assert.Equal(t, "pgx.acquire", spans[0].Name)
	assert.Equal(t, trace.SpanKindInternal, spans[0].SpanKind)
	assert.Equal(t, trace.SpanFromContext(parent).SpanContext(), spans[0].Parent)
	assert.Equal(t, []attribute.KeyValue{
		attribute.String("db.system.name", "postgresql"),
		attribute.String("error.type", "context.deadlineExceededError"),
	}, spans[0].Attributes)
	assert.Equal(t, sdktrace.Status{Code: codes.Error}, spans[0].Status)
	assert.False(t, spans[0].EndTime.Before(spans[0].StartTime))
}

// An acquire gets a span only when it waited: the span covers the wait, from
// a start time that is past when the span is made.
func TestRecordAcquire(t *testing.T) {
	start := time.Date(2026, time.November, 13, 12, 0, 0, 0, time.UTC)
	for _, tt := range []struct {
		name     string
		took     time.Duration
		err      error
		wantSpan bool
	}{
		{name: "idle connection", took: 3 * time.Microsecond},
		{name: "just under the threshold", took: acquireSpanThreshold - time.Nanosecond},
		{name: "at the threshold", took: acquireSpanThreshold, wantSpan: true},
		{name: "waited for a full pool", took: 250 * time.Millisecond, wantSpan: true},
		{name: "failed at once", took: 0, err: context.Canceled, wantSpan: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			spanExporter.Reset()

			recordAcquire(sampledContext(t), start, start.Add(tt.took), tt.err)

			spans := spanExporter.GetSpans()
			if !tt.wantSpan {
				assert.Empty(t, spans)
				return
			}
			require.Len(t, spans, 1)
			assert.Equal(t, "pgx.acquire", spans[0].Name)
			assert.True(t, spans[0].StartTime.Equal(start), "start %s", spans[0].StartTime)
			assert.Equal(t, tt.took, spans[0].EndTime.Sub(spans[0].StartTime))
		})
	}
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
