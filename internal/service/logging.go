package service

import (
	"context"
	"log/slog"

	"github.com/zitadel/zitadel/v5/internal/instrumentation/zlog"
)

func getLoggingContext(ctx context.Context, svcname string) *slog.Logger {
	logger := zlog.GetLoggingContext(ctx)
	logger = zlog.WithStream(logger, zlog.StreamService).
		With(slog.String("service_name", svcname))
	return logger
}
