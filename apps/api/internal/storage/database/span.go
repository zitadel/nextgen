package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"runtime"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.39.0"
	"go.opentelemetry.io/otel/trace"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

const pkgPath = "github.com/zitadel/nextgen/internal/storage/database"

var tracer = otel.Tracer(pkgPath)

// StartStatement traces and times one statement call for the calling
// statement method, e.g. "tokenStatements.GetTokenByID". system is the
// db.system.name value. Call the returned func with the statement's error:
// it ends the span and records the duration on db.client.operation.duration
// with the method as db.query.summary. A missing row is not an error.
//
// The span carries no SQL, arguments or error message: driver messages hold
// user values. The span is started only when the parent span is recording,
// and the duration recorded only when a meter provider collects it; when
// neither is the case nothing is named or allocated.
func StartStatement(ctx context.Context, system metrics.DBSystem) (context.Context, func(err error)) {
	tracing := trace.SpanFromContext(ctx).IsRecording()
	metering := metrics.StatementEnabled(ctx)
	if !tracing && !metering {
		return ctx, func(error) {}
	}
	name := statementName()
	var span trace.Span
	if tracing {
		ctx, span = tracer.Start(ctx, name, trace.WithAttributes(semconv.DBSystemNameKey.String(string(system))))
	}
	start := time.Now()
	return ctx, func(err error) {
		if span != nil {
			if err != nil && !errors.Is(err, sql.ErrNoRows) && !errors.Is(err, new(NoRowFoundError)) {
				span.SetStatus(codes.Error, "")
				span.SetAttributes(semconv.ErrorTypeKey.String(fmt.Sprintf("%T", err)))
			}
			span.End()
		}
		if metering {
			metrics.RecordStatement(ctx, system, name, time.Since(start))
		}
	}
}

var receiverReplacer = strings.NewReplacer("(*", "", ")", "")

// statementName returns the first method that called the dialect's
// tracedExecutor, without its package path and closure suffix:
// "pkg.(*T).M.func1" becomes "T.M". Frames with no receiver are skipped, so a
// helper such as withTransaction or execAffected names its calling method.
func statementName() string {
	var pcs [8]uintptr
	n := runtime.Callers(3, pcs[:]) // skip Callers, statementName, StartStatement
	frames := runtime.CallersFrames(pcs[:n])
	for {
		frame, more := frames.Next()
		if !strings.HasPrefix(frame.Function, pkgPath+".") {
			name := frame.Function[strings.LastIndexByte(frame.Function, '/')+1:]
			name = receiverReplacer.Replace(name[strings.IndexByte(name, '.')+1:])
			if i := strings.Index(name, ".func"); i >= 0 {
				name = name[:i]
				// A closure in an inlined method also carries the name of the
				// function it was inlined into ("Caller.T.M.func1"): keep "T.M".
				if j := strings.LastIndexByte(name, '.'); j >= 0 {
					name = name[strings.LastIndexByte(name[:j], '.')+1:]
				}
			}
			if strings.Contains(name, ".") && !strings.HasPrefix(name, "tracedExecutor.") {
				return name
			}
		}
		if !more {
			return "statement"
		}
	}
}
