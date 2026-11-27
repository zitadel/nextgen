package metrics

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
)

// The instruments are created on an SDK meter without error, and report
// themselves disabled exactly when nothing collects: that is the premise
// behind skipping the statement name lookup through StatementEnabled.
func TestNewInstruments_EnabledOnlyWithAReader(t *testing.T) {
	t.Parallel()

	silent, err := newInstruments(sdkmetric.NewMeterProvider().Meter(ScopeName))
	require.NoError(t, err)
	assert.False(t, silent.operationDuration.Enabled(t.Context()), "no reader: nothing to record for")

	reader := sdkmetric.NewManualReader()
	collecting, err := newInstruments(sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader)).Meter(ScopeName))
	require.NoError(t, err)
	assert.True(t, collecting.operationDuration.Enabled(t.Context()))
}
