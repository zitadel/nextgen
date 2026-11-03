package zotel

import (
	"context"
	"fmt"
	"os"

	"go.opentelemetry.io/contrib/exporters/autoexport"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploggrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/exporters/stdout/stdoutlog"
	"go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/sdk/resource"
)

func NewLoggerProvider(ctx context.Context, cfg ExporterConfig, resource *resource.Resource) (_ *log.LoggerProvider, err error) {
	exporter, err := cfg.logging(ctx)
	if err != nil {
		return nil, fmt.Errorf("log exporter: %w", err)
	}

	opts := []log.LoggerProviderOption{
		log.WithResource(resource),
	}

	if exporter != nil {
		opts = append(opts, log.WithProcessor(
			log.NewBatchProcessor(
				exporter,
				log.WithExportInterval(cfg.BatchDuration),
			),
		))
	}

	loggerProvider := log.NewLoggerProvider(opts...)
	return loggerProvider, nil
}

func (cfg ExporterConfig) logging(ctx context.Context) (log.Exporter, error) {
	switch cfg.Type {
	case ExporterTypeAuto:
		// autoexport delegates exporter selection to the standard OTEL env vars.
		// We can't just call autoexport.NewLogExporter unconditionally because
		// autoexport defaults to "otlp" when OTEL_LOGS_EXPORTER is unset, and
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
		if os.Getenv("OTEL_LOGS_EXPORTER") != "" ||
			os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") != "" ||
			os.Getenv("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT") != "" ||
			os.Getenv("OTEL_EXPORTER_OTLP_PROTOCOL") != "" ||
			os.Getenv("OTEL_EXPORTER_OTLP_LOGS_PROTOCOL") != "" {
			exporter, err := autoexport.NewLogExporter(ctx)
			if err == nil && autoexport.IsNoneLogExporter(exporter) {
				return nil, nil
			}
			return exporter, err
		}
	case ExporterTypeUnspecified, ExporterTypeNone:
		// no exporter
	case ExporterTypeStdOut, ExporterTypeStdErr:
		return logStdOutExporter(cfg)
	case ExporterTypeGRPC:
		return logGrpcExporter(ctx, cfg)
	case ExporterTypeHTTP:
		return logHttpExporter(ctx, cfg)
	case ExporterTypeGoogle, ExporterTypePrometheus:
		fallthrough // google, prometheus are not supported for logs
	default:
		return nil, errExporterType(cfg.Type, "logger")
	}
	return nil, nil
}

func logStdOutExporter(cfg ExporterConfig) (log.Exporter, error) {
	options := []stdoutlog.Option{
		stdoutlog.WithPrettyPrint(),
	}
	if cfg.Type == ExporterTypeStdErr {
		options = append(options, stdoutlog.WithWriter(os.Stderr))
	}
	exporter, err := stdoutlog.New(options...)
	if err != nil {
		return nil, err
	}
	return exporter, nil
}

func logGrpcExporter(ctx context.Context, cfg ExporterConfig) (log.Exporter, error) {
	var grpcOpts []otlploggrpc.Option
	if cfg.Endpoint != "" {
		grpcOpts = append(grpcOpts, otlploggrpc.WithEndpoint(cfg.Endpoint))
	}
	if cfg.Insecure {
		grpcOpts = append(grpcOpts, otlploggrpc.WithInsecure())
	}

	exporter, err := otlploggrpc.New(ctx, grpcOpts...)
	if err != nil {
		return nil, err
	}
	return exporter, nil
}

func logHttpExporter(ctx context.Context, cfg ExporterConfig) (log.Exporter, error) {
	var httpOpts []otlploghttp.Option
	if cfg.Endpoint != "" {
		httpOpts = append(httpOpts, otlploghttp.WithEndpoint(cfg.Endpoint))
	}
	if cfg.Insecure {
		httpOpts = append(httpOpts, otlploghttp.WithInsecure())
	}

	exporter, err := otlploghttp.New(ctx, httpOpts...)
	if err != nil {
		return nil, err
	}
	return exporter, nil
}
