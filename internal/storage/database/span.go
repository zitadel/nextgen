package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"runtime"
	"strings"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.39.0"
	"go.opentelemetry.io/otel/trace"
)

const pkgPath = "github.com/zitadel/nextgen/internal/storage/database"

var tracer = otel.Tracer(pkgPath)

// StartStatementSpan starts a span named after the calling statement method,
// e.g. "tokenStatements.GetTokenByID". system is the db.system.name value:
// postgresql, sqlite or gcp.spanner. Call the returned func with the
// statement's error to end the span. A missing row is not an error.
//
// The span carries no SQL, arguments or error message: driver messages hold
// user values. Nothing is started when the parent is not sampled.
func StartStatementSpan(ctx context.Context, system string) (context.Context, func(err error)) {
	if !trace.SpanContextFromContext(ctx).IsSampled() {
		return ctx, func(error) {}
	}
	ctx, span := tracer.Start(ctx, statementName(), trace.WithAttributes(semconv.DBSystemNameKey.String(system)))
	return ctx, func(err error) {
		if err != nil && !errors.Is(err, sql.ErrNoRows) && !errors.Is(err, new(NoRowFoundError)) {
			span.SetStatus(codes.Error, "")
			span.SetAttributes(semconv.ErrorTypeKey.String(fmt.Sprintf("%T", err)))
		}
		span.End()
	}
}

var receiverReplacer = strings.NewReplacer("(*", "", ")", "")

// statementName returns the first method that called the dialect's
// tracedExecutor, without its package path and closure suffix:
// "pkg.(*T).M.func1" becomes "T.M". Frames with no receiver are skipped, so a
// helper such as withTransaction or execAffected names its calling method.
func statementName() string {
	var pcs [8]uintptr
	n := runtime.Callers(3, pcs[:]) // skip Callers, statementName, StartStatementSpan
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
