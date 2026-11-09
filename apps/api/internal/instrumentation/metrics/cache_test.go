package metrics_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

// collect reads the instruments back through a real SDK reader, which is what
// proves they were registered and recorded rather than that the calls compiled.
// Sums are keyed by instrument, and by result where the point carries one, so
// hits and misses stay distinguishable.
func collect(t *testing.T, reader metric.Reader) map[string]int64 {
	t.Helper()

	var collected metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(t.Context(), &collected))

	sums := map[string]int64{}
	for _, scope := range collected.ScopeMetrics {
		for _, m := range scope.Metrics {
			switch data := m.Data.(type) {
			case metricdata.Sum[int64]:
				for _, point := range data.DataPoints {
					name := m.Name
					if result, ok := point.Attributes.Value("result"); ok {
						name += "." + result.Emit()
					}
					sums[name] += point.Value
				}
			case metricdata.Gauge[int64]:
				for _, point := range data.DataPoints {
					sums[m.Name] += point.Value
				}
			}
		}
	}
	return sums
}

// All four signals #1100 asks for, off one instrument set.
func TestCache_RecordsEverySignal(t *testing.T) {
	t.Parallel()

	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))

	entries := 3
	m, err := metrics.NewCache("probe", func() int { return entries },
		metrics.WithMeterProvider(provider))
	require.NoError(t, err)

	m.RecordLookup(true)
	m.RecordLookup(false)
	m.RecordLookup(false)
	m.RecordAdd(true)
	m.RecordAdd(false) // a write that evicted nothing must not count

	sums := collect(t, reader)
	assert.Equal(t, int64(1), sums["zitadel.cache.lookups.hit"])
	assert.Equal(t, int64(2), sums["zitadel.cache.lookups.miss"])
	assert.Equal(t, int64(1), sums["zitadel.cache.evictions"])
	assert.Equal(t, int64(3), sums["zitadel.cache.entries"])
}

// The gauge is polled at collection, not pushed on write. A cache that grows
// after the instruments were built still reports its current length.
func TestCache_EntriesArePolled(t *testing.T) {
	t.Parallel()

	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))

	entries := 0
	_, err := metrics.NewCache("probe", func() int { return entries },
		metrics.WithMeterProvider(provider))
	require.NoError(t, err)

	assert.Equal(t, int64(0), collect(t, reader)["zitadel.cache.entries"])
	entries = 7
	assert.Equal(t, int64(7), collect(t, reader)["zitadel.cache.entries"])
}

// Every cache shares one instrument set, so the `cache` attribute has to be
// what separates them. Without it a dashboard reads one cache's traffic as
// another's.
func TestCache_AreSeparatedByName(t *testing.T) {
	t.Parallel()

	reader := metric.NewManualReader()
	provider := metric.NewMeterProvider(metric.WithReader(reader))
	meterOpt := metrics.WithMeterProvider(provider)

	first, err := metrics.NewCache("first", func() int { return 0 }, meterOpt)
	require.NoError(t, err)
	second, err := metrics.NewCache("second", func() int { return 0 }, meterOpt)
	require.NoError(t, err)

	first.RecordLookup(true)
	second.RecordLookup(true)
	second.RecordLookup(true)

	var collected metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(t.Context(), &collected))

	byCache := map[string]int64{}
	for _, scope := range collected.ScopeMetrics {
		for _, m := range scope.Metrics {
			if m.Name != metrics.CacheLookups {
				continue
			}
			for _, point := range m.Data.(metricdata.Sum[int64]).DataPoints {
				name, ok := point.Attributes.Value("cache")
				require.True(t, ok, "every lookup point has to name the cache it came from")
				byCache[name.Emit()] += point.Value
			}
		}
	}
	assert.Equal(t, map[string]int64{"first": 1, "second": 2}, byCache)
}

// Built without a meter, the recorders still work and record nothing. That is
// what lets a constructor take the option without every caller supplying one.
func TestCache_MeterIsOptional(t *testing.T) {
	t.Parallel()

	// A provider exists and is collecting; this instrument set is not using it.
	reader := metric.NewManualReader()
	_ = metric.NewMeterProvider(metric.WithReader(reader))

	m, err := metrics.NewCache("probe", func() int { return 1 })
	require.NoError(t, err)

	m.RecordLookup(true)
	m.RecordAdd(true)

	assert.Empty(t, collect(t, reader),
		"a cache with no meter must not record onto anyone else's")
}
