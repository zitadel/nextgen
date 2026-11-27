package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.39.0"
	"go.opentelemetry.io/otel/trace"
)

var tracer = otel.Tracer("github.com/zitadel/nextgen/internal/storage/dialect/postgres")

// pgxTracer adds a span for every pgx query and for a pool acquire that had
// to wait. The spans carry no SQL, arguments, connection info or error
// message: they can hold user values. Of a query they name the verb alone.
type pgxTracer struct{}

var (
	_ pgx.QueryTracer       = pgxTracer{}
	_ pgxpool.AcquireTracer = pgxTracer{}
)

// TraceQueryStart implements [pgx.QueryTracer].
func (pgxTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if !trace.SpanFromContext(ctx).IsRecording() {
		return ctx
	}
	attrs := []attribute.KeyValue{dbSystemAttr}
	if operation := operationName(data.SQL); operation != "" {
		attrs = append(attrs, semconv.DBOperationName(operation))
	}
	ctx, _ = tracer.Start(ctx, "pgx.query", trace.WithSpanKind(trace.SpanKindClient), trace.WithAttributes(attrs...))
	return ctx
}

// TraceQueryEnd implements [pgx.QueryTracer].
func (pgxTracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	span := trace.SpanFromContext(ctx)
	// Same check as the start: when no span was started, this is the caller's.
	if !span.IsRecording() {
		return
	}
	setPGXError(span, data.Err)
	span.End()
}

// acquireSpanThreshold is how long a pool acquire takes before it gets a
// span. Taking an idle connection is a lock and a slice pop, 2 to 3 µs, and
// the span of each, five to a request, said nothing. An acquire that takes a
// millisecond did more: it waited for a connection to come back to a full
// pool, for a new one to be dialled, or for the ping pgx sends a connection
// that sat idle for over a second. A millisecond is some 300 times the idle
// case, so a busy scheduler does not reach it, and no longer than the
// shortest of those waits, a round trip to the database.
const acquireSpanThreshold = time.Millisecond

type acquireStartKey struct{}

// TraceAcquireStart implements [pgxpool.AcquireTracer]. It only notes the
// time: a started span cannot be dropped, and whether this acquire is worth
// one shows at the end.
func (pgxTracer) TraceAcquireStart(ctx context.Context, _ *pgxpool.Pool, _ pgxpool.TraceAcquireStartData) context.Context {
	if !trace.SpanFromContext(ctx).IsRecording() {
		return ctx
	}
	return context.WithValue(ctx, acquireStartKey{}, time.Now())
}

// TraceAcquireEnd implements [pgxpool.AcquireTracer].
func (pgxTracer) TraceAcquireEnd(ctx context.Context, _ *pgxpool.Pool, data pgxpool.TraceAcquireEndData) {
	if start, ok := ctx.Value(acquireStartKey{}).(time.Time); ok {
		recordAcquire(ctx, start, time.Now(), data.Err)
	}
}

// recordAcquire adds the pgx.acquire span of an acquire that ran from start
// to end, when it took [acquireSpanThreshold] or failed.
func recordAcquire(ctx context.Context, start, end time.Time, err error) {
	if err == nil && end.Sub(start) < acquireSpanThreshold {
		return
	}
	_, span := tracer.Start(ctx, "pgx.acquire",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithTimestamp(start),
		trace.WithAttributes(dbSystemAttr),
	)
	setPGXError(span, err)
	span.End(trace.WithTimestamp(end))
}

var dbSystemAttr = semconv.DBSystemNameKey.String(string(dbSystem))

func setPGXError(span trace.Span, err error) {
	if err != nil {
		span.SetStatus(codes.Error, "")
		span.SetAttributes(semconv.ErrorTypeKey.String(fmt.Sprintf("%T", err)))
	}
}

// operationNames are the words a PostgreSQL command starts with, each mapped
// to itself.
var operationNames = func() map[string]string {
	names := map[string]string{}
	for _, name := range []string{
		"ABORT", "ALTER", "ANALYZE", "BEGIN", "CALL", "CHECKPOINT", "CLOSE", "CLUSTER", "COMMENT", "COMMIT", "COPY",
		"CREATE", "DEALLOCATE", "DECLARE", "DELETE", "DISCARD", "DO", "DROP", "END", "EXECUTE", "EXPLAIN", "FETCH",
		"GRANT", "IMPORT", "INSERT", "LISTEN", "LOAD", "LOCK", "MERGE", "MOVE", "NOTIFY", "PREPARE", "REASSIGN",
		"REFRESH", "REINDEX", "RELEASE", "RESET", "REVOKE", "ROLLBACK", "SAVEPOINT", "SECURITY", "SELECT", "SET",
		"SHOW", "START", "TABLE", "TRUNCATE", "UNLISTEN", "UPDATE", "VACUUM", "VALUES", "WITH",
	} {
		names[name] = name
	}
	return names
}()

// operationName returns the db.operation.name of a statement: the word it
// starts with, in upper case, as in SELECT, INSERT, WITH or BEGIN. pgx sends
// its own statements in lower case ("begin", "rollback to savepoint sp_1"),
// so the case is folded. The result is one of [operationNames] or empty,
// which is what keeps every other part of a statement out of the span.
func operationName(sql string) string {
	// What may stand before the word: white space, and the parenthesis of
	// "(SELECT ...) UNION ...".
	start := 0
	for start < len(sql) && (sql[start] == ' ' || sql[start] == '\t' || sql[start] == '\n' || sql[start] == '\r' || sql[start] == '(') {
		start++
	}
	var word [len("DEALLOCATE")]byte
	n := 0
	for ; start+n < len(sql); n++ {
		c := sql[start+n]
		if c >= 'a' && c <= 'z' {
			c -= 'a' - 'A'
		}
		if c < 'A' || c > 'Z' {
			break
		}
		if n == len(word) {
			return ""
		}
		word[n] = c
	}
	return operationNames[string(word[:n])]
}
