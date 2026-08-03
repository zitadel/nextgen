package zotel

import (
	"context"
	"os"

	google "github.com/GoogleCloudPlatform/opentelemetry-operations-go/exporter/metric"
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
)

func NewMeterProvider(ctx context.Context, cfg ExporterConfig, resource *resource.Resource) (_ *sdkmetric.MeterProvider, err error) {
	readerOption, err := cfg.metrics(ctx)
	if err != nil {
		return nil, err
	}

	// create a view to filter out unwanted attributes
	view := sdkmetric.NewView(
		sdkmetric.Instrument{
			Scope: instrumentation.Scope{Name: otelhttp.ScopeName},
		},
		sdkmetric.Stream{
			AttributeFilter: attribute.NewAllowKeysFilter("http.method", "http.status_code", "http.target"),
		},
	)

	opts := []sdkmetric.Option{
		sdkmetric.WithResource(resource),
		sdkmetric.WithView(view),
	}
	if readerOption != nil {
		opts = append(opts, readerOption)
	}
	meterProvider := sdkmetric.NewMeterProvider(opts...)
	return meterProvider, nil
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
		if os.Getenv("OTEL_METRICS_EXPORTER") != "" ||
			os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") != "" ||
			os.Getenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") != "" ||
			os.Getenv("OTEL_EXPORTER_OTLP_PROTOCOL") != "" ||
			os.Getenv("OTEL_EXPORTER_OTLP_METRICS_PROTOCOL") != "" {
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
