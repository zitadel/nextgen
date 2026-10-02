package zotel_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/trace"

	"github.com/zitadel/nextgen/internal/instrumentation/zotel"
)

func TestNewOtelMetrics_tracing(t *testing.T) {
	tests := []struct {
		name          string
		exporter      zotel.ExporterConfig
		wantRecording bool
	}{
		{name: "no exporter turns tracing off", exporter: zotel.ExporterConfig{}, wantRecording: false},
		{name: "stdout exporter records", exporter: zotel.ExporterConfig{Type: zotel.ExporterTypeStdOut}, wantRecording: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			metrics, err := zotel.NewOtelMetrics(t.Context(), zotel.MetricsConfig{
				ServiceName:     "test",
				TraceIdFraction: 1.0,
				TraceExporter:   tt.exporter,
			})
			require.NoError(t, err)
			t.Cleanup(func() { _ = metrics.Shutdown(context.Background()) })

			// The span is never ended, so the stdout exporter has nothing to print.
			_, span := metrics.TracerProvider().Tracer("test").Start(t.Context(), "root", trace.WithSpanKind(trace.SpanKindServer))
			assert.Equal(t, tt.wantRecording, span.IsRecording())
		})
	}
}
