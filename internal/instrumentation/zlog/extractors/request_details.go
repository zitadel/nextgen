package extractors

import (
	"context"
	"log/slog"
	"time"
)

func RequestDetailsExtractor(ctx context.Context, _ time.Time, _ slog.Level, _ string) []slog.Attr {
	return nil
}
