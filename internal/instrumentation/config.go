package instrumentation

import (
	"log/slog"
	"os"
	"slices"

	slogctx "github.com/veqryn/slog-context"
	slogotel "github.com/veqryn/slog-context/otel"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog/extractors"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog/replacers"
	"github.com/zitadel/sloggcp"
)

const Name = "zitadel/backend/v3/instrumentation/tracing"

type LogConfig struct {
	Level     zlog.Level
	Streams   []zlog.Stream
	Mask      MaskConfig
	Format    LogFormat
	AddSource bool
	Errors    ErrorConfig
	// TODO
	//Exporter  ExporterConfig
}

func (cfg LogConfig) SlogHandlerOptions() *slog.HandlerOptions {
	return &slog.HandlerOptions{
		AddSource:   cfg.AddSource,
		Level:       cfg.Level,
		ReplaceAttr: cfg.AttributeReplacer(),
	}
}

func (cfg LogConfig) AttributeReplacer() zlog.AttributeReplacer {
	return func(groups []string, attr slog.Attr) slog.Attr {
		if replacer := cfg.Mask.AttributeReplacer(); replacer != nil {
			attr = replacer(groups, attr)
		}
		if cfg.Format == LogFormatGCP {
			attr = sloggcp.ReplaceAttr(groups, attr)
		}
		if cfg.Format == LogFormatGCPErrorReporting {
			attr = replacers.ReplaceErrKeys(groups, attr)
		}
		return attr
	}
}

type LogFormat int

//go:generate go tool enumer -type=LogFormat -trimprefix=LogFormat -text -linecomment -transform=snake
const (
	LogFormatUnspecified LogFormat = iota //
	LogFormatDisabled
	LogFormatText
	LogFormatJSON
	// LogFormatGCP formats logs as Google Cloud Platform compatible JSON
	LogFormatGCP
	LogFormatGCPErrorReporting
)

func (f LogFormat) ErrorHandler(options *slog.HandlerOptions) slog.Handler {
	var stdErrHandler slog.Handler
	switch f {
	case LogFormatUnspecified:
		return slog.Default().Handler()
	case LogFormatDisabled:
		stdErrHandler = slog.DiscardHandler
	case LogFormatText:
		stdErrHandler = slog.NewTextHandler(os.Stderr, options)
	case LogFormatJSON:
		stdErrHandler = slog.NewJSONHandler(os.Stderr, options)
	case LogFormatGCP:
		stdErrHandler = slog.NewJSONHandler(os.Stderr, options)
	case LogFormatGCPErrorReporting:
		// TODO refactor this out (move to param instead of global?)
		// zerrors.GCPErrorReportingEnabled(true)
		stdErrHandler = sloggcp.NewErrorReportingHandler(os.Stderr, options)
	}

	return slogctx.NewHandler(
		stdErrHandler,
		&slogctx.HandlerOptions{
			Prependers: []slogctx.AttrExtractor{
				extractors.ErrCauseExtractor,
				extractors.RequestDetailsExtractor,
				slogotel.ExtractTraceSpanID,
				slogctx.ExtractPrepended,
			},
		},
	)
}

type MaskConfig struct {
	Keys  []string
	Value string
}

func (c MaskConfig) AttributeReplacer() zlog.AttributeReplacer {
	keys := slices.Clone(c.Keys)
	slices.Sort(keys)
	return func(groups []string, a slog.Attr) slog.Attr {
		// mask all entries in a matching group, e.g. "data.*"
		for _, g := range groups {
			if _, found := slices.BinarySearch(keys, g); found {
				a.Value = slog.StringValue(c.Value)
				return a
			}
		}
		if _, found := slices.BinarySearch(keys, a.Key); found {
			a.Value = slog.StringValue(c.Value)
		}
		return a
	}
}

type ErrorConfig struct {
	ReportLocation bool
	StackTrace     bool
}
