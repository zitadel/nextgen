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

var noop = slog.New(slog.DiscardHandler)

func New(stream Stream, args ...any) *slog.Logger {
	if !IsStreamEnabled(stream) {
		return noop
	}

	return slog.Default().With(append(args,
		slog.String(StreamAttributeKey, stream.String()),
		slog.String(VersionAttributeKey, build.Version()),
	))
}

type AttributeReplacer func(groups []string, a slog.Attr) slog.Attr
