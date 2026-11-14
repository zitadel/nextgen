package zotel

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func endOneSpan(t *testing.T, batchDuration time.Duration) *tracetest.InMemoryExporter {
	t.Helper()
	exporter := tracetest.NewInMemoryExporter()
	provider := trace.NewTracerProvider(trace.WithBatcher(exporter, spanBatchOptions(batchDuration)...))
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	_, span := provider.Tracer("test").Start(context.Background(), "span")
	span.End()
	return exporter
}

func TestSpanBatchOptions(t *testing.T) {
	t.Run("unset waits for the SDK's default", func(t *testing.T) {
		t.Setenv("OTEL_BSP_SCHEDULE_DELAY", "")
		exporter := endOneSpan(t, 0)
		time.Sleep(100 * time.Millisecond)
		assert.Empty(t, exporter.GetSpans(), "a zero timeout exports at once, on every loop")
	})
	t.Run("set is the batch timeout", func(t *testing.T) {
		exporter := endOneSpan(t, 10*time.Millisecond)
		assert.Eventually(t, func() bool { return len(exporter.GetSpans()) == 1 }, time.Second, 5*time.Millisecond)
	})
}
