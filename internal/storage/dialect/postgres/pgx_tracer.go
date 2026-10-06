package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.39.0"
	"go.opentelemetry.io/otel/trace"
)

var tracer = otel.Tracer("github.com/zitadel/nextgen/internal/storage/dialect/postgres")

// pgxTracer adds a span for every pgx query and pool acquire. The spans carry
// no SQL, arguments, connection info or error message: they can hold user
// values.
type pgxTracer struct{}

var (
	_ pgx.QueryTracer       = pgxTracer{}
	_ pgxpool.AcquireTracer = pgxTracer{}
)

// TraceQueryStart implements [pgx.QueryTracer].
func (pgxTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryStartData) context.Context {
	return startPGXSpan(ctx, "pgx.query", trace.SpanKindClient)
}

// TraceQueryEnd implements [pgx.QueryTracer].
func (pgxTracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	endPGXSpan(ctx, data.Err)
}

// TraceAcquireStart implements [pgxpool.AcquireTracer].
func (pgxTracer) TraceAcquireStart(ctx context.Context, _ *pgxpool.Pool, _ pgxpool.TraceAcquireStartData) context.Context {
	return startPGXSpan(ctx, "pgx.acquire", trace.SpanKindInternal)
}

// TraceAcquireEnd implements [pgxpool.AcquireTracer].
func (pgxTracer) TraceAcquireEnd(ctx context.Context, _ *pgxpool.Pool, data pgxpool.TraceAcquireEndData) {
	endPGXSpan(ctx, data.Err)
}

func startPGXSpan(ctx context.Context, name string, kind trace.SpanKind) context.Context {
	if !trace.SpanFromContext(ctx).IsRecording() {
		return ctx
	}
	ctx, _ = tracer.Start(ctx, name, trace.WithSpanKind(kind), trace.WithAttributes(semconv.DBSystemNameKey.String(dbSystem)))
	return ctx
}

func endPGXSpan(ctx context.Context, err error) {
	span := trace.SpanFromContext(ctx)
	// Same check as the start: when no span was started, this is the caller's.
	if !span.IsRecording() {
		return
	}
	if err != nil {
		span.SetStatus(codes.Error, "")
		span.SetAttributes(semconv.ErrorTypeKey.String(fmt.Sprintf("%T", err)))
	}
	span.End()
}
