// Package errlog writes the one log line an error the server answers gets
// (ADR 030). The line carries the error and whatever the site adds; the
// status, operation, method and path are on the request line, which shares
// the request id on the request logger.
package errlog

import (
	"context"
	"errors"
	"log/slog"
	"os"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/errreport"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

// Log writes the `api error` line for err, at the level the error decides:
// Error for a server fault ([domain.IsServerFault]; an error that is not a
// [domain.Error] counts as one and is logged as an internal fault, located
// where Log was called), or Warn instead when the request context is already
// done and the error is not the server's write deadline, because then the
// client left; Info for everything else. Use [LogLevel] when a site owns its
// level.
func Log(ctx context.Context, err error, attrs ...slog.Attr) {
	domErr := asDomainError(err)
	level := slog.LevelInfo
	if domain.IsServerFault(domErr) {
		level = slog.LevelError
		// The request context is done when the client left, or when net/http
		// hit the server's write deadline, which the deadline error tells
		// apart.
		if ctx.Err() != nil && !errors.Is(err, os.ErrDeadlineExceeded) {
			level = slog.LevelWarn
		}
	}
	write(ctx, level, domErr, attrs)
}

// LogFault writes the line for an error answered with a 5xx, whatever its
// code: Error, or Warn instead when the request context is already done and
// the error is not the server's write deadline. A code no mapper covers
// answers 500 without being a server fault, and still is one.
func LogFault(ctx context.Context, err error, attrs ...slog.Attr) {
	domErr := asDomainError(err)
	level := slog.LevelError
	if ctx.Err() != nil && !errors.Is(err, os.ErrDeadlineExceeded) {
		level = slog.LevelWarn
	}
	write(ctx, level, domErr, attrs)
}

// LogLevel is [Log] at the level the caller chose. Below Error the line
// carries the brief error shape, at Error the full one (ADR 030).
func LogLevel(ctx context.Context, level slog.Level, err error, attrs ...slog.Attr) {
	write(ctx, level, asDomainError(err), attrs)
}

// asDomainError returns the domain error err carries, or err as an internal
// fault. A plain error has no location of its own, so the fault takes the
// one of the call into this package rather than this line: call it directly
// from the exported functions.
func asDomainError(err error) domain.Error {
	if domErr, ok := errors.AsType[domain.Error](err); ok {
		return domErr
	}
	domErr := domain.ErrInternal(err)
	domErr.Origin = errreport.Capture(err, 2)
	return domErr
}

func write(ctx context.Context, level slog.Level, domErr domain.Error, attrs []slog.Attr) {
	var logged error = domErr
	if level < slog.LevelError {
		logged = domErr.Brief()
	}
	args := []any{slog.Any(zlog.ErrorAttributeKey, logged)}
	for _, attr := range attrs {
		args = append(args, attr)
	}
	zlog.Log(ctx, level, "api error", args...)
}
