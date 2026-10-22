package zotel

import (
	"context"
	"errors"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/log"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/propagation"
	logsdk "go.opentelemetry.io/otel/sdk/log"
	metricsdk "go.opentelemetry.io/otel/sdk/metric"
	tracesdk "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

type MetricsConfig struct {
	ServiceName     string
	TraceIdFraction float64
	TraceExporter   ExporterConfig
	MetricExporter  ExporterConfig
	LogExporter     ExporterConfig
}

type Metrics interface {
	LoggerProvider() log.LoggerProvider
	TracerProvider() trace.TracerProvider
	MeterProvider() metric.MeterProvider
	TextMapPropagator() propagation.TextMapPropagator
}

func NewOtelMetrics(ctx context.Context, config MetricsConfig) (*OtelMetrics, error) {
	otelResource, err := CreateResource(config.ServiceName)
	if err != nil {
		return nil, err
	}

	propagator := propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	)
	otel.SetTextMapPropagator(propagator)

	tracerProvider, err := NewTracerProvider(ctx, config.TraceExporter, config.TraceIdFraction, otelResource)
	if err != nil {
		return nil, err
	}
	otel.SetTracerProvider(tracerProvider)

	meterProvider, err := NewMeterProvider(ctx, config.MetricExporter, otelResource)
	if err != nil {
		return nil, err
	}
	otel.SetMeterProvider(meterProvider)

	loggerProvider, err := NewLoggerProvider(ctx, config.LogExporter, otelResource)
	if err != nil {
		return nil, err
	}

	return &OtelMetrics{
		loggerProvider:    loggerProvider,
		tracerProvider:    tracerProvider,
		meterProvider:     meterProvider,
		textMapPropagator: propagator,
	}, nil
}

type OtelMetrics struct {
	loggerProvider    *logsdk.LoggerProvider
	tracerProvider    *tracesdk.TracerProvider
	meterProvider     *metricsdk.MeterProvider
	textMapPropagator propagation.TextMapPropagator
}

func (m *OtelMetrics) LoggerProvider() log.LoggerProvider {
	return m.loggerProvider
}

func (m *OtelMetrics) TracerProvider() trace.TracerProvider {
	return m.tracerProvider
}

func (m *OtelMetrics) MeterProvider() metric.MeterProvider {
	return m.meterProvider
}

func (m *OtelMetrics) TextMapPropagator() propagation.TextMapPropagator {
	return m.textMapPropagator
}

func (m *OtelMetrics) Shutdown(ctx context.Context) error {
	var err error

	if m.loggerProvider != nil {
		errors.Join(err, m.loggerProvider.Shutdown(ctx))
	}
	if m.tracerProvider != nil {
		errors.Join(err, m.tracerProvider.Shutdown(ctx))
	}
	if m.meterProvider != nil {
		errors.Join(err, m.meterProvider.Shutdown(ctx))
	}

	return err
}
