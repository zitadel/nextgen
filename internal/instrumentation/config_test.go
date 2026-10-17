package instrumentation

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	slogotel "github.com/veqryn/slog-context/otel"
	tracesdk "go.opentelemetry.io/otel/sdk/trace"
)

// TestLogFormat_ErrorHandler_UnspecifiedTraceID covers the format that falls back to
// the process default handler: a log line written inside a sampled span must carry
// the trace and span ID, like it does for every explicit format.
func TestLogFormat_ErrorHandler_UnspecifiedTraceID(t *testing.T) {
	// ErrorHandler wraps slog.Default() at call time, so swap it for a capturing one.
	// This mutates global state, so the test must not run in parallel.
	var out bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&out, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	logger := slog.New(LogFormatUnspecified.ErrorHandler(nil))

	provider := tracesdk.NewTracerProvider(tracesdk.WithSampler(tracesdk.AlwaysSample()))
	t.Cleanup(func() { _ = provider.Shutdown(t.Context()) })

	t.Run("inside a sampled span", func(t *testing.T) {
		out.Reset()
		ctx, span := provider.Tracer("test").Start(t.Context(), "op")
		defer span.End()

		logger.InfoContext(ctx, "inside span")

		var line map[string]any
		require.NoError(t, json.Unmarshal(out.Bytes(), &line))
		assert.Equal(t, span.SpanContext().TraceID().String(), line[slogotel.DefaultKeyTraceID])
		assert.Equal(t, span.SpanContext().SpanID().String(), line[slogotel.DefaultKeySpanID])
	})

	t.Run("outside a span", func(t *testing.T) {
		out.Reset()

		logger.InfoContext(t.Context(), "no span")

		var line map[string]any
		require.NoError(t, json.Unmarshal(out.Bytes(), &line))
		assert.Equal(t, "no span", line[slog.MessageKey])
		assert.NotContains(t, line, slogotel.DefaultKeyTraceID)
		assert.NotContains(t, line, slogotel.DefaultKeySpanID)
	})
}
