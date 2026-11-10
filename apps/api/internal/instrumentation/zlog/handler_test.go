package zlog_test

import (
	"bytes"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

// TestHandler_Streams checks that a line is written only when its logger's
// stream is in the configured list, and that a logger without a stream is
// always written.
func TestHandler_Streams(t *testing.T) {
	for _, tt := range []struct {
		name   string
		logger func(*slog.Logger) *slog.Logger
		want   []string
	}{
		{
			name:   "disabled stream is dropped",
			logger: func(l *slog.Logger) *slog.Logger { return zlog.WithStream(l, zlog.StreamStorage) },
		},
		{
			name:   "enabled stream is kept",
			logger: func(l *slog.Logger) *slog.Logger { return zlog.WithStream(l, zlog.StreamRequest) },
			want:   []string{`"msg":"line"`, `"stream":"request"`},
		},
		{
			name:   "stream survives a later With",
			logger: func(l *slog.Logger) *slog.Logger { return zlog.WithStream(l, zlog.StreamStorage).With("k", "v") },
		},
		{
			name: "unknown stream value keeps the filter",
			logger: func(l *slog.Logger) *slog.Logger {
				return zlog.WithStream(l, zlog.StreamStorage).With("stream", "kafka")
			},
		},
		{
			name:   "logger without stream is kept",
			logger: func(l *slog.Logger) *slog.Logger { return l },
			want:   []string{`"msg":"line"`},
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var buf bytes.Buffer
			logger := zlog.NewLogger(zlog.NewHandler(slog.LevelDebug, []zlog.Stream{zlog.StreamRequest}, slog.NewJSONHandler(&buf, nil)))

			tt.logger(logger).Info("line")

			if len(tt.want) == 0 {
				assert.Empty(t, buf.String())
			}
			for _, want := range tt.want {
				assert.Contains(t, buf.String(), want)
			}
		})
	}
}
