package zlog

import (
	"log/slog"

	"github.com/zitadel/sloggcp"
	"github.com/zitadel/zitadel/v5/internal/build"
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
