package zlog

import (
	"context"
	"log/slog"
	"slices"
)

type Handler struct {
	minLevel slog.Level
	streams  []Stream
	handler  slog.Handler
}

func NewHandler(
	minLevel slog.Level,
	streams []Stream,
	handler slog.Handler,
) *Handler {
	return &Handler{
		minLevel: minLevel,
		streams:  streams,
		handler:  handler,
	}
}

func (h Handler) Enabled(ctx context.Context, level slog.Level) bool {
	return level >= h.minLevel && h.handler.Enabled(ctx, level)
}

func (h Handler) Handle(ctx context.Context, record slog.Record) error {
	stream := streamFromRecord(record)
	if stream != StreamUnspecified && !slices.Contains(h.streams, stream) {
		return nil
	}
	return h.handler.Handle(ctx, record)
}

func (h Handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return NewHandler(
		h.minLevel,
		h.streams,
		h.handler.WithAttrs(attrs),
	)
}

func (h Handler) WithGroup(name string) slog.Handler {
	return NewHandler(
		h.minLevel,
		h.streams,
		h.handler.WithGroup(name),
	)
}

func streamFromRecord(record slog.Record) Stream {
	stream := StreamUnspecified
	record.Attrs(func(attr slog.Attr) bool {
		if attr.Key != StreamAttributeKey {
			return true
		}

		v, ok := attr.Value.Any().(Stream)
		if ok {
			stream = v
		}
		return false
	})
	return stream
}

var _ slog.Handler = (*Handler)(nil)
