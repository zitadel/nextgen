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
	// stream is the one [WithStream] set; StreamUnspecified means no filter.
	stream Stream
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
	if h.stream != StreamUnspecified && !slices.Contains(h.streams, h.stream) {
		return nil
	}
	return h.handler.Handle(ctx, record)
}

func (h Handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	for _, attr := range attrs {
		if attr.Key == StreamAttributeKey {
			if stream, err := StreamString(attr.Value.String()); err == nil {
				h.stream = stream
			}
		}
	}
	h.handler = h.handler.WithAttrs(attrs)
	return &h
}

func (h Handler) WithGroup(name string) slog.Handler {
	h.handler = h.handler.WithGroup(name)
	return &h
}

var _ slog.Handler = (*Handler)(nil)
