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
			if attr, ok, _ := withoutAttrs(attr, keys); ok {
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

// withoutAttrs returns attr without the attributes named keys inside it.
// keep is false when attr itself is one of them. An attr with nothing to drop
// is returned as it came, since a handler may need the value behind a group:
// the GCP handler reads the stack from the error.
func withoutAttrs(attr slog.Attr, keys []string) (_ slog.Attr, keep, changed bool) {
	if slices.Contains(keys, attr.Key) {
		return attr, false, true
	}
	value := attr.Value.Resolve()
	if value.Kind() != slog.KindGroup {
		return attr, true, false
	}
	var kept []slog.Attr
	for _, member := range value.Group() {
		member, keep, memberChanged := withoutAttrs(member, keys)
		changed = changed || memberChanged
		if keep {
			kept = append(kept, member)
		}
	}
	if !changed {
		return attr, true, false
	}
	return slog.Attr{Key: attr.Key, Value: slog.GroupValue(kept...)}, true, true
}
