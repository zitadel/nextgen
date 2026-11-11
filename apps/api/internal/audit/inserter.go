package audit

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

// EventInserter persists a single event (Path B TX site or Path A batch item).
type EventInserter interface {
	InsertEvent(ctx context.Context, event *domain.Event) error
}

// EventBatchInserter persists a Path A flush batch whole or not at all (one
// TX). The flusher's retry relies on it: a duplicate after a failed attempt
// means that attempt wrote the whole batch.
type EventBatchInserter interface {
	InsertEvents(ctx context.Context, events []*domain.Event) error
}

// BatchInserter adapts a batch insert func to EventBatchInserter.
type BatchInserter func(ctx context.Context, events []*domain.Event) error

func (f BatchInserter) InsertEvents(ctx context.Context, events []*domain.Event) error {
	return f(ctx, events)
}

// SequentialBatchInserter inserts each event via EventInserter. It can write
// part of a batch, so it is for tests only.
type SequentialBatchInserter struct {
	Inner EventInserter
}

func (s SequentialBatchInserter) InsertEvents(ctx context.Context, events []*domain.Event) error {
	for _, ev := range events {
		if err := s.Inner.InsertEvent(ctx, ev); err != nil {
			return err
		}
	}
	return nil
}
