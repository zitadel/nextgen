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
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

// Log writes the `api error` line for err, at the level the error decides:
// Error for a server fault ([domain.IsServerFault]; an error that is not a
// [domain.Error] counts as one and is logged as an internal fault), or Warn
// instead when the request context is already done and the error is not
// the server's write deadline, because then the client left; Info for
// everything else. Use [LogLevel] when a site owns its level.
func Log(ctx context.Context, err error, attrs ...slog.Attr) {
	level := slog.LevelInfo
	if domain.IsServerFault(err) {
		level = slog.LevelError
		// The request context is done when the client left, or when net/http
		// hit the server's write deadline, which the deadline error tells
		// apart.
		if ctx.Err() != nil && !errors.Is(err, os.ErrDeadlineExceeded) {
			level = slog.LevelWarn
		}
	}
	LogLevel(ctx, level, err, attrs...)
}

// LogFault writes the line for an error answered with a 5xx, whatever its
// code: Error, or Warn instead when the request context is already done and
// the error is not the server's write deadline. A code no mapper covers
// answers 500 without being a server fault, and still is one.
func LogFault(ctx context.Context, err error, attrs ...slog.Attr) {
	level := slog.LevelError
	if ctx.Err() != nil && !errors.Is(err, os.ErrDeadlineExceeded) {
		level = slog.LevelWarn
	}
	LogLevel(ctx, level, err, attrs...)
}

// LogLevel is [Log] at the level the caller chose. Below Error the line
// carries the brief error shape, at Error the full one (ADR 030).
func LogLevel(ctx context.Context, level slog.Level, err error, attrs ...slog.Attr) {
	domErr, ok := errors.AsType[domain.Error](err)
	if !ok {
		domErr = domain.ErrInternal(err)
	}
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
