package zlog

import (
	"context"
	"log/slog"
	"runtime"
	"time"

	slogctx "github.com/veqryn/slog-context"
)

func WithLoggingContext(ctx context.Context, logger *slog.Logger) context.Context {
	return slogctx.NewCtx(ctx, logger)
}

func GetLoggingContext(ctx context.Context) *slog.Logger {
	return slogctx.FromCtx(ctx)
}

func Log(ctx context.Context, level slog.Level, msg string, args ...any) {
	log(ctx, GetLoggingContext(ctx), level, msg, 1, args...)
}

func Debug(ctx context.Context, msg string, args ...any) {
	log(ctx, GetLoggingContext(ctx), slog.LevelDebug, msg, 1, args...)
}

func Info(ctx context.Context, msg string, args ...any) {
	log(ctx, GetLoggingContext(ctx), slog.LevelInfo, msg, 1, args...)
}

func Warn(ctx context.Context, msg string, args ...any) {
	log(ctx, GetLoggingContext(ctx), slog.LevelWarn, msg, 1, args...)
}

func Error(ctx context.Context, msg string, args ...any) {
	log(ctx, GetLoggingContext(ctx), slog.LevelError, msg, 1, args...)
}

func WithError(ctx context.Context, err error) *ErrorContextLogger {
	return &ErrorContextLogger{
		ctx:          ctx,
		logger:       GetLoggingContext(ctx).With(slog.Any(ErrorAttributeKey, err)),
		canTerminate: true,
	}
}

func log(ctx context.Context, logger *slog.Logger, level slog.Level, msg string, skip int, args ...any) {
	handler := logger.Handler()
	if !handler.Enabled(ctx, level) {
		return
	}
	var pcs [1]uintptr
	if IsAddSourceEnabled() {
		runtime.Callers(skip+2, pcs[:])

	}
	r := slog.NewRecord(time.Now(), level, msg, pcs[0])
	r.Add(args...)
	_ = logger.Handler().Handle(ctx, r)
}
