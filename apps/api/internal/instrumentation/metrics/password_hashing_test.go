package metrics_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

func TestPasswordHashing_RecordsEverySignal(t *testing.T) {
	t.Parallel()

	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))

	m, err := metrics.NewPasswordHashing(metrics.PasswordHashingState{
		InFlight:       func() int64 { return 3 },
		Waiting:        func() int64 { return 5 },
		MemoryReserved: func() int64 { return 7 },
	}, metrics.WithMeterProvider(provider))
	require.NoError(t, err)

	m.RecordRejected()
	m.RecordRejected()
	m.RecordWait(250 * time.Millisecond)
	m.RecordWait(0)

	got := collect(t, reader)
	assert.Equal(t, int64(3), got[metrics.PasswordHashingInFlight])
	assert.Equal(t, int64(5), got[metrics.PasswordHashingWaiting])
	assert.Equal(t, int64(7), got[metrics.PasswordHashingMemoryReserved])
	assert.Equal(t, int64(2), got[metrics.PasswordHashingRejected])

	var collected metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(t.Context(), &collected))
	var waits uint64
	for _, scope := range collected.ScopeMetrics {
		for _, inst := range scope.Metrics {
			if inst.Name != metrics.PasswordHashingWaitDuration {
				continue
			}
			hist, ok := inst.Data.(metricdata.Histogram[float64])
			require.True(t, ok)
			for _, point := range hist.DataPoints {
				waits += point.Count
			}
		}
	}
	assert.Equal(t, uint64(2), waits)
}

func TestPasswordHashing_NoProviderRecordsNothing(t *testing.T) {
	t.Parallel()

	m, err := metrics.NewPasswordHashing(metrics.PasswordHashingState{
		InFlight:       func() int64 { return 0 },
		Waiting:        func() int64 { return 0 },
		MemoryReserved: func() int64 { return 0 },
	})
	require.NoError(t, err)
	m.RecordRejected()
	m.RecordWait(time.Second)
}
