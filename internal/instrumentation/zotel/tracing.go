package zotel

import (
	"context"
	"fmt"
	"os"

	google_trace "github.com/GoogleCloudPlatform/opentelemetry-operations-go/exporter/trace"
	"go.opentelemetry.io/contrib/exporters/autoexport"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
	"go.opentelemetry.io/otel/sdk/resource"
	"go.opentelemetry.io/otel/sdk/trace"
	trace2 "go.opentelemetry.io/otel/trace"
)

func NewTracerProvider(ctx context.Context, cfg ExporterConfig, traceIDRatio float64, resource *resource.Resource) (*trace.TracerProvider, error) {
	exporter, err := cfg.tracing(ctx)
	if err != nil {
		return nil, fmt.Errorf("trace exporter: %w", err)
	}

	fraction := trace.TraceIDRatioBased(traceIDRatio)
	sampler := trace.ParentBased(
		spanKindBased(fraction, trace2.SpanKindServer),
		trace.WithRemoteParentNotSampled(fraction),
	)

	opts := []trace.TracerProviderOption{
		trace.WithResource(resource),
		trace.WithSampler(sampler),
	}
	if exporter != nil {
		opts = append(opts, trace.WithBatcher(exporter, trace.WithBatchTimeout(cfg.BatchDuration)))
	}
	tracerProvider := trace.NewTracerProvider(opts...)
	return tracerProvider, nil
}

func (cfg ExporterConfig) tracing(ctx context.Context) (_ trace.SpanExporter, err error) {
	var exporter trace.SpanExporter
	switch cfg.Type {
	case ExporterTypeAuto:
		// autoexport delegates exporter selection to the standard OTEL env vars.
		// We can't just call autoexport.NewSpanExporter unconditionally because
		// autoexport defaults to "otlp" when OTEL_TRACES_EXPORTER is unset, and
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
		if os.Getenv("OTEL_TRACES_EXPORTER") != "" ||
			os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") != "" ||
			os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") != "" ||
			os.Getenv("OTEL_EXPORTER_OTLP_PROTOCOL") != "" ||
			os.Getenv("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL") != "" {
			exporter, err = autoexport.NewSpanExporter(ctx)
			if err == nil && autoexport.IsNoneSpanExporter(exporter) {
				return nil, nil
			}
			return exporter, nil
		}
		return nil, nil
	case ExporterTypeUnspecified, ExporterTypeNone:
		return nil, nil
	case ExporterTypeStdOut, ExporterTypeStdErr:
		return traceStdOutExporter(cfg)
	case ExporterTypeGRPC:
		return traceGrpcExporter(ctx, cfg)
	case ExporterTypeHTTP:
		return traceHttpExporter(ctx, cfg)
	case ExporterTypeGoogle:
		return traceGoogleExporter(ctx, cfg)
	case ExporterTypePrometheus:
		fallthrough // prometheus is not supported for traces
	default:
		return nil, errExporterType(cfg.Type, "tracer")
	}
}

func traceStdOutExporter(cfg ExporterConfig) (trace.SpanExporter, error) {
	options := []stdouttrace.Option{
		stdouttrace.WithPrettyPrint(),
	}
	if cfg.Type == ExporterTypeStdErr {
		options = append(options, stdouttrace.WithWriter(os.Stderr))
	}
	exporter, err := stdouttrace.New(options...)
	if err != nil {
		return nil, err
	}
	return exporter, nil
}

func traceGrpcExporter(ctx context.Context, cfg ExporterConfig) (trace.SpanExporter, error) {
	var grpcOpts []otlptracegrpc.Option
	if cfg.Endpoint != "" {
		grpcOpts = append(grpcOpts, otlptracegrpc.WithEndpoint(cfg.Endpoint))
	}
	if cfg.Insecure {
		grpcOpts = append(grpcOpts, otlptracegrpc.WithInsecure())
	}

	exporter, err := otlptracegrpc.New(ctx, grpcOpts...)
	if err != nil {
		return nil, err
	}
	return exporter, nil
}

func traceHttpExporter(ctx context.Context, cfg ExporterConfig) (trace.SpanExporter, error) {
	var httpOpts []otlptracehttp.Option
	if cfg.Endpoint != "" {
		httpOpts = append(httpOpts, otlptracehttp.WithEndpoint(cfg.Endpoint))
	}
	if cfg.Insecure {
		httpOpts = append(httpOpts, otlptracehttp.WithInsecure())
	}

	exporter, err := otlptracehttp.New(ctx, httpOpts...)
	if err != nil {
		return nil, err
	}
	return exporter, nil
}

func traceGoogleExporter(ctx context.Context, cfg ExporterConfig) (trace.SpanExporter, error) {
	exporter, err := google_trace.New(
		google_trace.WithContext(ctx),
		google_trace.WithProjectID(cfg.GoogleProjectID),
	)
	if err != nil {
		return nil, err
	}
	return exporter, nil
}
