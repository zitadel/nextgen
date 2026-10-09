package zotel

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	logsdk "go.opentelemetry.io/otel/sdk/log"
	metricsdk "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	tracesdk "go.opentelemetry.io/otel/sdk/trace"
)

var (
	errLogShutdown    = errors.New("log exporter shutdown failed")
	errTraceShutdown  = errors.New("trace exporter shutdown failed")
	errMetricShutdown = errors.New("metric exporter shutdown failed")
)

type logExporter struct{ shutdownErr error }

func (logExporter) Export(context.Context, []logsdk.Record) error { return nil }
func (e logExporter) Shutdown(context.Context) error              { return e.shutdownErr }
func (logExporter) ForceFlush(context.Context) error              { return nil }

type traceExporter struct{ shutdownErr error }

func (traceExporter) ExportSpans(context.Context, []tracesdk.ReadOnlySpan) error { return nil }
func (e traceExporter) Shutdown(context.Context) error                           { return e.shutdownErr }

type metricExporter struct{ shutdownErr error }

func (metricExporter) Temporality(metricsdk.InstrumentKind) metricdata.Temporality {
	return metricdata.CumulativeTemporality
}
func (metricExporter) Aggregation(kind metricsdk.InstrumentKind) metricsdk.Aggregation {
	return metricsdk.DefaultAggregationSelector(kind)
}
func (metricExporter) Export(context.Context, *metricdata.ResourceMetrics) error { return nil }
func (metricExporter) ForceFlush(context.Context) error                          { return nil }
func (e metricExporter) Shutdown(context.Context) error                          { return e.shutdownErr }

// newTestMetrics builds an OtelMetrics whose providers fail at shutdown with the given errors.
// A nil error makes that provider's exporter shut down cleanly.
func newTestMetrics(logErr, traceErr, metricErr error) *OtelMetrics {
	return &OtelMetrics{
		loggerProvider: logsdk.NewLoggerProvider(
			logsdk.WithProcessor(logsdk.NewSimpleProcessor(logExporter{shutdownErr: logErr})),
		),
		tracerProvider: tracesdk.NewTracerProvider(
			tracesdk.WithSyncer(traceExporter{shutdownErr: traceErr}),
		),
		meterProvider: metricsdk.NewMeterProvider(
			metricsdk.WithReader(metricsdk.NewPeriodicReader(metricExporter{shutdownErr: metricErr})),
		),
	}
}

func TestOtelMetrics_Shutdown(t *testing.T) {
	tests := []struct {
		name    string
		metrics *OtelMetrics
		wantErr []error
	}{
		{
			name:    "all providers shut down cleanly",
			metrics: newTestMetrics(nil, nil, nil),
		},
		{
			name:    "no providers configured",
			metrics: &OtelMetrics{},
		},
		{
			name:    "logger provider fails",
			metrics: newTestMetrics(errLogShutdown, nil, nil),
			wantErr: []error{errLogShutdown},
		},
		{
			name:    "tracer provider fails",
			metrics: newTestMetrics(nil, errTraceShutdown, nil),
			wantErr: []error{errTraceShutdown},
		},
		{
			name:    "meter provider fails",
			metrics: newTestMetrics(nil, nil, errMetricShutdown),
			wantErr: []error{errMetricShutdown},
		},
		{
			name:    "every provider fails and none is masked",
			metrics: newTestMetrics(errLogShutdown, errTraceShutdown, errMetricShutdown),
			wantErr: []error{errLogShutdown, errTraceShutdown, errMetricShutdown},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.metrics.Shutdown(t.Context())
			if len(tt.wantErr) == 0 {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			for _, want := range tt.wantErr {
				assert.ErrorIs(t, err, want)
			}
		})
	}
}
