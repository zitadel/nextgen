package extractors

import (
	"context"
	"log/slog"
	"time"

	"github.com/zitadel/nextgen/internal/api/middleware"
)

func ExtractRequestID(ctx context.Context, _ time.Time, _ slog.Level, _ string) []slog.Attr {
	requestId, ok := middleware.GetRequestIDContext(ctx)
	if !ok {
		return nil
	}
	return []slog.Attr{
		slog.String("request_id", requestId),
	}
}
