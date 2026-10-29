package zotel_test

import (
	"slices"
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
	"github.com/zitadel/nextgen/internal/instrumentation/metrics/metricstest"
	"github.com/zitadel/nextgen/internal/instrumentation/zotel"
)

// attributeKeys collects, per instrument, every attribute key that survived
// the views.
func attributeKeys(t *testing.T, reader sdkmetric.Reader) map[string][]attribute.Key {
	t.Helper()
	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(t.Context(), &rm))
	out := map[string][]attribute.Key{}
	for name, in := range metricstest.Instruments(rm) {
		out[name] = in.Keys
	}
	return out
}

// The raw request path used to be an allowed attribute: one series per
// distinct /users/{id}. Whatever a handler or an HTTP wrapper attaches, only
// the operation, method, route template and status survive.
func TestMeterViews_HTTPAttributesAreBounded(t *testing.T) {
	t.Parallel()
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
	counter.Add(t.Context(), 1, metric.WithAttributes(slices.Concat(ogen, rogue)...))

	httpCounter, err := provider.Meter(otelhttp.ScopeName).Int64Counter("http.server.request.count")
	require.NoError(t, err)
	httpCounter.Add(t.Context(), 1, metric.WithAttributes(slices.Concat([]attribute.KeyValue{
		attribute.String("http.method", "GET"),
		attribute.Int("http.status_code", 200),
		attribute.String("http.route", "/users/{user_id}"),
	}, rogue)...))

	got := attributeKeys(t, reader)
	assert.ElementsMatch(t, []attribute.Key{"oas.operation", "http.request.method", "http.route", "http.response.status_code"}, got["ogen.server.request_count"])
	assert.ElementsMatch(t, []attribute.Key{"http.method", "http.status_code", "http.route"}, got["http.server.request.count"])
}

// A view is built from the catalogue, so an application instrument cannot
// pick up an attribute its catalogue entry does not declare, even when the
// code recording it passes one.
func TestMeterViews_ApplicationAttributesFollowTheCatalogue(t *testing.T) {
	t.Parallel()
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader), sdkmetric.WithView(zotel.MeterViews()...))

	counter, err := provider.Meter(metrics.ScopeName).Int64Counter(metrics.TokenRevocationChecks)
	require.NoError(t, err)
	counter.Add(t.Context(), 1, metric.WithAttributes(
		metrics.ResultKey.String(string(metrics.RevocationActive)),
		attribute.String("user_id", "usr_1"),
		attribute.String("project_id", "prj_1"),
	))

	assert.Equal(t, []attribute.Key{"result"}, attributeKeys(t, reader)[metrics.TokenRevocationChecks])
}
