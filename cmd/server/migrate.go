package server

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/spf13/cobra"

	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/instrumentation/zotel"
)

func newMigrateCommand(configPath *string) *cobra.Command {
	return &cobra.Command{
		Use:           "migrate",
		Short:         "Apply database migrations and exit",
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := loadConfig(*configPath)
			if err != nil {
				return err
			}
			return migrateDatabase(cmd.Context(), cfg)
		},
	}
}

func migrateDatabase(ctx context.Context, cfg Config) error {
	metrics, err := zotel.NewOtelMetrics(ctx, zotel.MetricsConfig{
		ServiceName:     cfg.Instrumentation.ServiceName,
		TraceIdFraction: cfg.Instrumentation.Trace.Fraction,
		TraceExporter:   cfg.Instrumentation.Trace.Exporter,
		MetricExporter:  cfg.Instrumentation.Metric.Exporter,
		LogExporter:     cfg.Instrumentation.Log.Exporter,
	})
	if err != nil {
		return fmt.Errorf("failed to create otel metrics: %w", err)
	}
	defer func() {
		_ = metrics.Shutdown(context.WithoutCancel(ctx))
	}()
	setUpLogging(cfg.Instrumentation.Log, metrics.LoggerProvider())
	ctx = zlog.WithLoggingContext(ctx, zlog.WithStream(slog.Default(), zlog.StreamRuntime))

	pool, err := startDatabase(ctx, cfg, true)
	if err != nil {
		return err
	}
	zlog.Info(ctx, "database migrations applied")
	if err := pool.Close(ctx); err != nil {
		zlog.WithError(ctx, err).Debug("closing database pool after migrate")
	}
	return nil
}
