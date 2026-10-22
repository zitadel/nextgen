package extractors

import (
	"context"
	"errors"
	"log/slog"
	"time"
)

func ExtractErrCause(ctx context.Context, _ time.Time, _ slog.Level, _ string) []slog.Attr {
	err := context.Cause(ctx)
	if err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
		return []slog.Attr{
			slog.String("cause", err.Error()),
		}
	}
	return nil
}
