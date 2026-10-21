//go:build postgres_integration

// Package tracing tests the spans of a real request, end to end. It is a
// package of its own because the global tracer provider can be set once per
// process, and the parallel tests in integration_test must not see it.
package tracing

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strconv"
	"testing"

	slogctx "github.com/veqryn/slog-context"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/noop"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/instrumentation/zotel"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dbtest"
)

var (
	harness helpers.Harness

	// spanExporter collects the spans of the test. It is nil in a benchmark
	// mode, where spans go to the exporter of that mode.
	spanExporter *tracetest.InMemoryExporter
)

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

func runTests(m *testing.M) int {
	ctx := context.Background()

	// Before anything traces: package tracers delegate to the first provider
	// set in the process.
	provider, err := tracerProvider(os.Getenv("BENCH_TRACING"))
	if err != nil {
		slog.Error("setup: tracer provider", slogctx.Err(err))
		return 1
	}
	otel.SetTracerProvider(provider)

	pool, stop, err := dbtest.Postgres(ctx)
	if err != nil {
		slog.Error("setup: failed to start database", slogctx.Err(err))
		return 1
	}
	defer stop()
	defer pool.Close(ctx)

	harness.DB = service.NewPool(pool)
	return m.Run()
}

// tracerProvider builds the provider for BENCH_TRACING: unset for the test
// (every span kept in memory), "off" for no tracing at all, or a sampling
// fraction for the production setup exporting to io.Discard, so the export
// work is measured without a network.
func tracerProvider(mode string) (trace.TracerProvider, error) {
	switch mode {
	case "":
		spanExporter = tracetest.NewInMemoryExporter()
		return sdktrace.NewTracerProvider(
			sdktrace.WithSyncer(spanExporter),
			sdktrace.WithSampler(zotel.NewSampler(1.0)),
		), nil
	case "off":
		return noop.NewTracerProvider(), nil
	}
	fraction, err := strconv.ParseFloat(mode, 64)
	if err != nil {
		return nil, fmt.Errorf("BENCH_TRACING=%q: want off or a fraction: %w", mode, err)
	}
	exporter, err := stdouttrace.New(stdouttrace.WithWriter(io.Discard))
	if err != nil {
		return nil, err
	}
	return sdktrace.NewTracerProvider(
		sdktrace.WithSampler(zotel.NewSampler(fraction)),
		sdktrace.WithBatcher(exporter),
	), nil
}
