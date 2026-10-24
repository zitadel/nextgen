package stage

import (
	"context"
	"fmt"

	v4 "github.com/zitadel/nextgen/internal/migratev4/v4"
)

// DefaultBatchSize is how many v4 events one ingest batch detects changes in.
const DefaultBatchSize = 2000

// ReducerVersion versions what the reducers fold. Bump it when they fold an
// event type they ignored before or fold one differently: an aggregate only
// reads past its staged sequence, so a stage folded by older reducers would
// never see the events it skipped. Ingest then restages from the start.
const ReducerVersion = 2

// IngestStats counts what one ingest read.
type IngestStats struct {
	Batches    int
	Events     int
	Aggregates int
	Cursor     v4.Cursor
	// Restaged is true when the stage was folded by other reducers and ingest
	// read v4 again from the start.
	Restaged bool
}

// Ingest folds the instance's new v4 events into the stage until it has read
// everything up to the moment of its last batch.
//
// Each batch first asks v4 which aggregates changed after the cursor, behind
// v4's barrier, then reads those aggregates' events after their staged
// sequence, in sequence order, and saves documents and cursor together. A
// crash before the save redoes the batch; nothing is folded twice because an
// aggregate only reads past its own staged sequence.
func Ingest(ctx context.Context, src *v4.Source, store *Store, instanceID string, batchSize int) (IngestStats, error) {
	if batchSize <= 0 {
		batchSize = DefaultBatchSize
	}
	types := EventTypes()
	filter := v4.NewTypeFilter(types)
	eventTypes := filter.EventTypes()

	stats := IngestStats{}
	cursor, version, err := store.Cursor(ctx, instanceID)
	if err != nil {
		return stats, err
	}
	if version != ReducerVersion {
		if err := store.ResetStage(ctx, instanceID); err != nil {
			return stats, err
		}
		cursor, stats.Restaged = v4.Start, true
	}
	for {
		keys, last, read, err := src.Changed(ctx, instanceID, cursor, filter, batchSize)
		if err != nil {
			return stats, err
		}
		if read == 0 {
			stats.Cursor = cursor
			return stats, nil
		}
		staged, err := store.Load(ctx, instanceID, keys)
		if err != nil {
			return stats, err
		}
		after := make(map[v4.AggregateKey]int64, len(staged))
		for key, st := range staged {
			after[key] = st.Sequence
		}
		events, err := src.Events(ctx, instanceID, after, eventTypes)
		if err != nil {
			return stats, err
		}
		byKey := map[v4.AggregateKey][]v4.Event{}
		for _, e := range events {
			key := v4.AggregateKey{Type: e.AggregateType, ID: e.AggregateID}
			byKey[key] = append(byKey[key], e)
		}
		changed := make([]*Staged, 0, len(staged))
		for _, key := range keys {
			st := staged[key]
			if err := st.Fold(byKey[key]); err != nil {
				return stats, fmt.Errorf("fold v4 events: %w", err)
			}
			changed = append(changed, st)
		}
		if err := store.Save(ctx, instanceID, changed, last); err != nil {
			return stats, err
		}
		cursor = last
		stats.Batches++
		stats.Events += read
		stats.Aggregates += len(changed)
		if read < batchSize {
			stats.Cursor = cursor
			return stats, nil
		}
	}
}
