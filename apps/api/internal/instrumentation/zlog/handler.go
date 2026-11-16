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
	if keys, _ := ctx.Value(withoutAttrsKey{}).([]string); len(keys) > 0 {
		kept := slog.NewRecord(record.Time, record.Level, record.Message, record.PC)
		record.Attrs(func(attr slog.Attr) bool {
			if attr, ok := withoutAttrs(attr, keys); ok {
				kept.AddAttrs(attr)
			}
			return true
		})
		record = kept
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

// withoutAttrs returns attr without the attributes named keys inside it, or
// false when attr itself is one of them.
func withoutAttrs(attr slog.Attr, keys []string) (slog.Attr, bool) {
	if slices.Contains(keys, attr.Key) {
		return attr, false
	}
	value := attr.Value.Resolve()
	if value.Kind() != slog.KindGroup {
		return attr, true
	}
	var kept []slog.Attr
	for _, member := range value.Group() {
		if member, ok := withoutAttrs(member, keys); ok {
			kept = append(kept, member)
		}
	}
	return slog.Attr{Key: attr.Key, Value: slog.GroupValue(kept...)}, true
}
