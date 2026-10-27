package zotel

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/resource"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

// The statement summary is an open attribute, fixed in code. Were it ever fed
// something request-shaped, the provider's cardinality limit is what keeps
// the series count bounded: past the limit, new values share one overflow
// series instead of each becoming their own.
//
// The limit is the SDK's default, which the SDK does not export. This test pins
// it: if an SDK upgrade changes the default, it fails and the docs need the new
// number.
func TestNewMeterProvider_BoundsSeriesPerInstrument(t *testing.T) {
	const sdkDefaultCardinalityLimit = 2000
	t.Setenv("OTEL_GO_X_CARDINALITY_LIMIT", "")
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(append(meterProviderOptions(resource.Empty()), sdkmetric.WithReader(reader))...)

	histogram, err := provider.Meter(metrics.ScopeName).Float64Histogram(metrics.DBOperationDuration, metric.WithUnit("s"))
	require.NoError(t, err)
	const distinct = 3_000
	for i := range distinct {
		histogram.Record(t.Context(), time.Millisecond.Seconds(), metric.WithAttributes(
			metrics.DBSystemNameKey.String(string(metrics.DBSystemPostgreSQL)),
			metrics.DBQuerySummaryKey.String(fmt.Sprintf("statements.Get%d", i)),
		))
	}

	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(t.Context(), &rm))

	var series int
	overflowed := false
	overflow := attribute.Bool("otel.metric.overflow", true)
	for _, scope := range rm.ScopeMetrics {
		for _, m := range scope.Metrics {
			if m.Name != metrics.DBOperationDuration {
				continue
			}
			for _, p := range m.Data.(metricdata.Histogram[float64]).DataPoints {
				series++
				if p.Attributes.HasValue(overflow.Key) {
					overflowed = true
					assert.Equal(t, attribute.NewSet(overflow), p.Attributes, "the overflow series carries only its marker")
				}
			}
		}
	}
	assert.LessOrEqual(t, series, sdkDefaultCardinalityLimit, "%d distinct values must not become %d series", distinct, series)
	assert.True(t, overflowed, "values past the limit land on the overflow series")
}
