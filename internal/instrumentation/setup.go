package instrumentation

import (
	"log/slog"

	slogmulti "github.com/samber/slog-multi"
	"go.opentelemetry.io/contrib/bridges/otelslog"
)

func SetDefaultLogger(
	cfg LogConfig,
) {
	// TODO refactor this out (move to param instead of global?)
	//addSourceEnabled.Store(cfg.AddSource)

	stdErrHandler := cfg.Format.ErrorHandler(cfg.SlogHandlerOptions())

	// TODO refactor this out
	//EnableStreams(cfg.Streams...)
	//zerrors.EnableReportLocation(cfg.Errors.ReportLocation)
	//zerrors.EnableStackTrace(cfg.Errors.StackTrace)

	otelHandler := otelslog.NewHandler(
		Name,
		otelslog.WithLoggerProvider(provider),
	)

	logger := slog.New(slogmulti.Fanout(stdErrHandler, otelHandler))
	logger.Info("structured logger configured", "config_level", cfg.Level, "format", cfg.Format)
	slog.SetDefault(logger)
}
