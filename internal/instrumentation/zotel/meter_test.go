package zotel_test

import (
	"testing"

	"github.com/ogen-go/ogen/otelogen"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/instrumentation/zotel"
)

// attributeKeys collects, per instrument, every attribute key that survived
// the views.
func attributeKeys(t *testing.T, reader sdkmetric.Reader) map[string][]string {
	t.Helper()
	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(t.Context(), &rm))
	out := map[string][]string{}
	for _, scope := range rm.ScopeMetrics {
		for _, m := range scope.Metrics {
			var sets []attribute.Set
			switch data := m.Data.(type) {
			case metricdata.Sum[int64]:
				for _, p := range data.DataPoints {
					sets = append(sets, p.Attributes)
				}
			case metricdata.Histogram[float64]:
				for _, p := range data.DataPoints {
					sets = append(sets, p.Attributes)
				}
			case metricdata.Gauge[int64]:
				for _, p := range data.DataPoints {
					sets = append(sets, p.Attributes)
				}
			}
			for _, set := range sets {
				for _, kv := range set.ToSlice() {
					if !contains(out[m.Name], string(kv.Key)) {
						out[m.Name] = append(out[m.Name], string(kv.Key))
					}
				}
			}
		}
	}
	return out
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

// The raw request path used to be an allowed attribute: one series per
// distinct /users/{id}. Whatever a handler or an HTTP wrapper attaches, only
// the operation, method, route template and status survive.
func TestMeterViews_HTTPAttributesAreBounded(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader), sdkmetric.WithView(zotel.MeterViews()...))

	rogue := []attribute.KeyValue{
		attribute.String("http.target", "/users/usr_123"),
		attribute.String("url.path", "/users/usr_123"),
		attribute.String("user_id", "usr_123"),
		attribute.String("server.address", "example.test"),
	}
	ogen := []attribute.KeyValue{
		otelogen.OperationID("GetUserByID"),
		attribute.String("http.request.method", "GET"),
		attribute.String("http.route", "/users/{user_id}"),
		attribute.Int("http.response.status_code", 200),
	}
	counter, err := otelogen.ServerRequestCountCounter(provider.Meter(otelogen.Name))
	require.NoError(t, err)
	counter.Add(t.Context(), 1, metricAttrs(append(ogen, rogue...)...))

	std := provider.Meter(otelhttp.ScopeName)
	httpCounter, err := std.Int64Counter("http.server.request.count")
	require.NoError(t, err)
	httpCounter.Add(t.Context(), 1, metricAttrs(append([]attribute.KeyValue{
		attribute.String("http.method", "GET"),
		attribute.Int("http.status_code", 200),
		attribute.String("http.route", "/users/{user_id}"),
	}, rogue...)...))

	got := attributeKeys(t, reader)
	assert.ElementsMatch(t, []string{"oas.operation", "http.request.method", "http.route", "http.response.status_code"}, got["ogen.server.request_count"])
	assert.ElementsMatch(t, []string{"http.method", "http.status_code", "http.route"}, got["http.server.request.count"])
}

// A view is built from the catalogue, so an application instrument cannot pick
// up an attribute its catalogue entry does not declare, even when the code
// recording it passes one.
func TestMeterViews_ApplicationAttributesFollowTheCatalogue(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader), sdkmetric.WithView(zotel.MeterViews()...))

	counter, err := provider.Meter(metrics.ScopeName).Int64Counter(metrics.TokenRevocationChecks)
	require.NoError(t, err)
	counter.Add(t.Context(), 1, metricAttrs(
		metrics.ResultKey.String("active"),
		attribute.String("user_id", "usr_1"),
		attribute.String("project_id", "prj_1"),
	))

	assert.Equal(t, []string{"result"}, attributeKeys(t, reader)[metrics.TokenRevocationChecks])
}

func metricAttrs(kvs ...attribute.KeyValue) metric.MeasurementOption {
	return metric.WithAttributes(kvs...)
}

func TestExporterConfig_MetricsEnabled(t *testing.T) {
	tests := []struct {
		name string
		typ  zotel.ExporterType
		env  map[string]string
		want bool
	}{
		{name: "unset", typ: zotel.ExporterTypeUnspecified, want: false},
		{name: "none", typ: zotel.ExporterTypeNone, want: false},
		{name: "none beats the environment", typ: zotel.ExporterTypeNone, env: map[string]string{"OTEL_METRICS_EXPORTER": "prometheus"}, want: false},
		{name: "prometheus", typ: zotel.ExporterTypePrometheus, want: true},
		{name: "stdout", typ: zotel.ExporterTypeStdOut, want: true},
		{name: "auto without environment", typ: zotel.ExporterTypeAuto, want: false},
		{name: "auto with an exporter named", typ: zotel.ExporterTypeAuto, env: map[string]string{"OTEL_METRICS_EXPORTER": "prometheus"}, want: true},
		{name: "auto with an endpoint", typ: zotel.ExporterTypeAuto, env: map[string]string{"OTEL_EXPORTER_OTLP_ENDPOINT": "http://collector:4318"}, want: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for _, k := range []string{"OTEL_METRICS_EXPORTER", "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "OTEL_EXPORTER_OTLP_PROTOCOL", "OTEL_EXPORTER_OTLP_METRICS_PROTOCOL"} {
				t.Setenv(k, tt.env[k])
			}
			assert.Equal(t, tt.want, zotel.ExporterConfig{Type: tt.typ}.MetricsEnabled())
		})
	}
}
