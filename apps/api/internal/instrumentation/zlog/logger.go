package zlog

import (
	"log/slog"

	"github.com/zitadel/nextgen/internal/build"
	"github.com/zitadel/sloggcp"
)

const (
	StreamAttributeKey  = "stream"
	VersionAttributeKey = "version"
	ErrorAttributeKey   = sloggcp.ErrorKey
)

func NewLogger(h slog.Handler) *slog.Logger {
	return slog.New(h).With(
		slog.String(VersionAttributeKey, build.Version()),
	)
}

func WithStream(logger *slog.Logger, stream Stream) *slog.Logger {
	return logger.
		With(slog.String(StreamAttributeKey, stream.String())).
		WithGroup(stream.String())
}

type AttributeReplacer func(groups []string, a slog.Attr) slog.Attr
