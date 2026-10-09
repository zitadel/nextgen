package zotel

import (
	"context"
	"os"

	google "github.com/GoogleCloudPlatform/opentelemetry-operations-go/exporter/metric"
	"github.com/ogen-go/ogen/otelogen"
	"go.opentelemetry.io/contrib/exporters/autoexport"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/prometheus"
	"go.opentelemetry.io/otel/exporters/stdout/stdoutmetric"
	"go.opentelemetry.io/otel/sdk/instrumentation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.39.0"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

// ogenAttributes are the attributes the generated server's request instruments
// may carry: the operation, and the method, route template and status it
// served. http.route is the template (`/users/{user_id}`), never the path.
var ogenAttributes = []attribute.Key{
	otelogen.OperationIDKey,
	semconv.HTTPRequestMethodKey,
	semconv.HTTPRouteKey,
	semconv.HTTPResponseStatusCodeKey,
}

// otelhttpAttributes are the same, under the names otelhttp uses, which still
// includes the pre-stable pair. The raw request path (http.target, url.path)
// is deliberately absent: every distinct /users/{id} would be a series of its
// own.
var otelhttpAttributes = []attribute.Key{
	semconv.HTTPRequestMethodKey,
	semconv.HTTPResponseStatusCodeKey,
	semconv.HTTPRouteKey,
	"http.method",
	"http.status_code",
}

// MeterViews returns the views every meter provider of the server is built
// with. They are what bounds the series count: an attribute that a view does
// not allow is dropped before it can create a series, whatever the code
// recording it passed.
//
//   - ogen's request instruments, which serve every API request, keep the
//     operation id, method, route template and status code.
//   - otelhttp, were it ever put in front of a handler, keeps the same.
//   - each application instrument keeps the attributes its catalogue entry
//     declares.
func MeterViews() []sdkmetric.View {
	views := []sdkmetric.View{
		allowAttributes(instrumentation.Scope{Name: otelogen.Name}, "", ogenAttributes),
		allowAttributes(instrumentation.Scope{Name: otelhttp.ScopeName}, "", otelhttpAttributes),
	}
	for _, in := range metrics.Catalogue() {
		views = append(views, allowAttributes(instrumentation.Scope{Name: metrics.ScopeName}, in.Name, in.AttributeKeys()))
	}
	return views
}

func allowAttributes(scope instrumentation.Scope, name string, keys []attribute.Key) sdkmetric.View {
	return sdkmetric.NewView(
		sdkmetric.Instrument{Name: name, Scope: scope},
		sdkmetric.Stream{AttributeFilter: attribute.NewAllowKeysFilter(keys...)},
	)
}

func NewMeterProvider(ctx context.Context, cfg ExporterConfig, resource *resource.Resource) (_ *sdkmetric.MeterProvider, err error) {
	readerOption, err := cfg.metrics(ctx)
	if err != nil {
		return nil, err
	}

	opts := []sdkmetric.Option{
		sdkmetric.WithResource(resource),
		sdkmetric.WithView(MeterViews()...),
	}
	if readerOption != nil {
		opts = append(opts, readerOption)
	}
	meterProvider := sdkmetric.NewMeterProvider(opts...)
	return meterProvider, nil
}

// otelMetricsEnvConfigured reports whether the standard OpenTelemetry
// environment says where metrics go.
func otelMetricsEnvConfigured() bool {
	return os.Getenv("OTEL_METRICS_EXPORTER") != "" ||
		os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") != "" ||
		os.Getenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") != "" ||
		os.Getenv("OTEL_EXPORTER_OTLP_PROTOCOL") != "" ||
		os.Getenv("OTEL_EXPORTER_OTLP_METRICS_PROTOCOL") != ""
}

// MetricsEnabled reports whether metrics are exported anywhere. When they are
// not, the application instruments are left off: there is nobody to read them,
// and recording one costs a stack walk per storage statement.
//
// For auto it is the guard [ExporterConfig.metrics] applies: an exporter
// type the environment names but that resolves to none is still reported as
// enabled, and costs only the recording.
func (cfg ExporterConfig) MetricsEnabled() bool {
	switch cfg.Type {
	case ExporterTypeUnspecified, ExporterTypeNone:
		return false
	case ExporterTypeAuto:
		return otelMetricsEnvConfigured()
	default:
		return true
	}
}

func (cfg ExporterConfig) metrics(ctx context.Context) (_ sdkmetric.Option, err error) {
	switch cfg.Type {
	case ExporterTypeAuto:
		// autoexport delegates reader selection to the standard OTEL env vars.
		// We can't just call autoexport.NewMetricReader unconditionally because
		// autoexport defaults to "otlp" when OTEL_METRICS_EXPORTER is unset, and
		// the OTLP exporter silently points at localhost:4318 even with no env
		// vars configured. That would cause every ZITADEL instance to start
		// attempting OTLP connections after upgrading, spamming logs with
		// connection errors.
		//
		// This guard is a heuristic: we check the env vars that realistically
		// indicate someone has intentionally configured OTEL export. It does not
		// cover every possible OTLP env var (e.g. OTEL_EXPORTER_OTLP_HEADERS or
		// OTEL_EXPORTER_OTLP_CERTIFICATE on their own), but those vars are
		// meaningless without an endpoint or exporter type being set too.
		if otelMetricsEnvConfigured() {
			var reader sdkmetric.Reader
			reader, err = autoexport.NewMetricReader(ctx)
			if err == nil && !autoexport.IsNoneMetricReader(reader) {
				return sdkmetric.WithReader(reader), nil
			}
		}
		return nil, nil
	case ExporterTypeUnspecified, ExporterTypeNone:
		return nil, nil
	case ExporterTypeStdOut, ExporterTypeStdErr:
		return metricStdOutOption(cfg)
	case ExporterTypeGRPC:
		return metricGrpcOption(ctx, cfg)
	case ExporterTypeHTTP:
		return metricHttpOption(ctx, cfg)
	case ExporterTypeGoogle:
		return metricGoogleOption(cfg)
	case ExporterTypePrometheus:
		return metricPrometheusOption()
	default:
		return nil, errExporterType(cfg.Type, "metrics")
	}
}

func metricStdOutOption(cfg ExporterConfig) (sdkmetric.Option, error) {
	options := []stdoutmetric.Option{
		stdoutmetric.WithPrettyPrint(),
	}
	if cfg.Type == ExporterTypeStdErr {
		options = append(options, stdoutmetric.WithWriter(os.Stderr))
	}
	exporter, err := stdoutmetric.New(options...)
	if err != nil {
		return nil, err
	}
	return sdkmetric.WithReader(
		sdkmetric.NewPeriodicReader(
			exporter,
			sdkmetric.WithInterval(cfg.BatchDuration),
		),
	), nil
}

func metricGrpcOption(ctx context.Context, cfg ExporterConfig) (sdkmetric.Option, error) {
	var grpcOpts []otlpmetricgrpc.Option
	if cfg.Endpoint != "" {
		grpcOpts = append(grpcOpts, otlpmetricgrpc.WithEndpoint(cfg.Endpoint))
	}
	if cfg.Insecure {
		grpcOpts = append(grpcOpts, otlpmetricgrpc.WithInsecure())
	}

	exporter, err := otlpmetricgrpc.New(ctx, grpcOpts...)
	if err != nil {
		return nil, err
	}
	return sdkmetric.WithReader(
		sdkmetric.NewPeriodicReader(
			exporter,
			sdkmetric.WithInterval(cfg.BatchDuration),
		),
	), nil
}

func metricHttpOption(ctx context.Context, cfg ExporterConfig) (sdkmetric.Option, error) {
	var httpOpts []otlpmetrichttp.Option
	if cfg.Endpoint != "" {
		httpOpts = append(httpOpts, otlpmetrichttp.WithEndpoint(cfg.Endpoint))
	}
	if cfg.Insecure {
		httpOpts = append(httpOpts, otlpmetrichttp.WithInsecure())
	}

	exporter, err := otlpmetrichttp.New(ctx, httpOpts...)
	if err != nil {
		return nil, err
	}
	return sdkmetric.WithReader(
		sdkmetric.NewPeriodicReader(
			exporter,
			sdkmetric.WithInterval(cfg.BatchDuration),
		),
	), nil
}

func metricGoogleOption(cfg ExporterConfig) (sdkmetric.Option, error) {
	exporter, err := google.New(
		google.WithProjectID(cfg.GoogleProjectID),
	)
	if err != nil {
		return nil, err
	}
	return sdkmetric.WithReader(
		sdkmetric.NewPeriodicReader(
			exporter,
			sdkmetric.WithInterval(cfg.BatchDuration),
		),
	), nil
}

func metricPrometheusOption() (sdkmetric.Option, error) {
	prom, err := prometheus.New(prometheus.WithoutScopeInfo())
	if err != nil {
		return nil, err
	}
	return sdkmetric.WithReader(prom), nil
}
