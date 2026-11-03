package v4

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Event is one row of eventstore.events2.
type Event struct {
	AggregateType string
	AggregateID   string
	Type          string
	Sequence      int64
	// Position is v4's numeric position, kept as text: the reader only ever
	// hands it back to the database.
	Position  string
	InTxOrder int64
	CreatedAt time.Time
	// Owner is the resource owner: the org id on user and org events, the
	// instance id on instance events.
	Owner string
	// Payload is the event's JSON, nil for events without one.
	Payload []byte
}

// AggregateKey identifies one aggregate of an instance.
type AggregateKey struct {
	Type string
	ID   string
}

// Cursor is the sort key of the last event read, v4's own EventSortKey without
// the instance, which a reader holds fixed.
type Cursor struct {
	Position      string
	InTxOrder     int64
	AggregateType string
	AggregateID   string
	Sequence      int64
}

// Start is the cursor before every event.
var Start = Cursor{Position: "0"}

// TypeFilter lists the (aggregate type, event type) pairs a reader wants.
type TypeFilter struct {
	pairs [][2]string
}

// NewTypeFilter builds a filter from event types per aggregate type.
func NewTypeFilter(types map[string][]string) TypeFilter {
	var f TypeFilter
	for aggregateType, eventTypes := range types {
		for _, eventType := range eventTypes {
			f.pairs = append(f.pairs, [2]string{aggregateType, eventType})
		}
	}
	return f
}

func (f TypeFilter) columns() (aggregateTypes, eventTypes []string) {
	for _, pair := range f.pairs {
		aggregateTypes = append(aggregateTypes, pair[0])
		eventTypes = append(eventTypes, pair[1])
	}
	return aggregateTypes, eventTypes
}

// EventTypes returns every event type in the filter.
func (f TypeFilter) EventTypes() []string {
	_, eventTypes := f.columns()
	return eventTypes
}

// changedQuery is v4's projection query (prepareEventTypeScans): one index
// range scan of es_projection per (aggregate type, event type), resumed after
// the cursor and capped at the reader's transaction start.
const changedQuery = `
SELECT e.aggregate_type, e.aggregate_id, e.position::text, e.in_tx_order, e.sequence
FROM unnest($2::text[], $3::text[]) AS scan(aggregate_type, event_type)
CROSS JOIN LATERAL (
	SELECT aggregate_type, aggregate_id, position, in_tx_order, sequence
	FROM eventstore.events2
	WHERE instance_id = $1
		AND aggregate_type = scan.aggregate_type
		AND event_type = scan.event_type
		AND (position, in_tx_order, aggregate_type, aggregate_id, sequence) > ($4::numeric, $5, $6, $7, $8)
		AND position <= EXTRACT(EPOCH FROM now())
	ORDER BY position, in_tx_order, aggregate_type, aggregate_id, sequence
	LIMIT $9
) e
ORDER BY e.position, e.in_tx_order, e.aggregate_type, e.aggregate_id, e.sequence
LIMIT $9`

// barrierQuery waits for every v4 writer of the instance that is still
// pushing: writers hold the shared lock on this key for their whole push.
const barrierQuery = `SELECT pg_advisory_lock('eventstore.events2'::regclass::oid::integer, hashtext($1)), pg_advisory_unlock('eventstore.events2'::regclass::oid::integer, hashtext($1))`

// Changed returns the aggregates with events of the filtered types after the
// cursor, reading at most limit events, and the cursor of the last one read.
// It reads behind v4's barrier: the lock and the select share one READ
// COMMITTED transaction, so now() is no later than the lock.
//
// Changed only detects change. The events themselves come from [Source.Events]
// per aggregate in sequence order, so an aggregate is folded correctly however
// v4 stamped positions.
func (s *Source) Changed(ctx context.Context, instanceID string, after Cursor, filter TypeFilter, limit int) (keys []AggregateKey, last Cursor, read int, err error) {
	last = after
	aggregateTypes, eventTypes := filter.columns()
	err = s.readTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, barrierQuery, instanceID); err != nil {
			return fmt.Errorf("wait for v4 writers: %w", err)
		}
		rows, err := tx.Query(ctx, changedQuery,
			instanceID, aggregateTypes, eventTypes,
			after.Position, after.InTxOrder, after.AggregateType, after.AggregateID, after.Sequence,
			limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		seen := map[AggregateKey]bool{}
		for rows.Next() {
			var c Cursor
			if err := rows.Scan(&c.AggregateType, &c.AggregateID, &c.Position, &c.InTxOrder, &c.Sequence); err != nil {
				return err
			}
			key := AggregateKey{Type: c.AggregateType, ID: c.AggregateID}
			if !seen[key] {
				seen[key] = true
				keys = append(keys, key)
			}
			last = c
			read++
		}
		return rows.Err()
	})
	if err != nil {
		return nil, after, 0, fmt.Errorf("read changed v4 aggregates: %w", err)
	}
	return keys, last, read, nil
}

// eventsQuery reads each aggregate's events after its own sequence on the
// events2 primary key. Sequences of one aggregate become visible in order, so
// nothing below the newest one returned can still appear later.
const eventsQuery = `
SELECT e.aggregate_type, e.aggregate_id, e.event_type, e.sequence, e.position::text, e.in_tx_order, e.created_at, e.owner, e.payload
FROM unnest($2::text[], $3::text[], $4::bigint[]) AS a(aggregate_type, aggregate_id, sequence)
JOIN eventstore.events2 e
	ON e.instance_id = $1
	AND e.aggregate_type = a.aggregate_type
	AND e.aggregate_id = a.aggregate_id
	AND e.sequence > a.sequence
WHERE e.event_type = ANY($5)
ORDER BY e.aggregate_type, e.aggregate_id, e.sequence`

// Events returns the events of the given types of each aggregate after the
// sequence it maps to, ordered by aggregate and sequence.
func (s *Source) Events(ctx context.Context, instanceID string, after map[AggregateKey]int64, eventTypes []string) ([]Event, error) {
	if len(after) == 0 {
		return nil, nil
	}
	aggregateTypes := make([]string, 0, len(after))
	aggregateIDs := make([]string, 0, len(after))
	sequences := make([]int64, 0, len(after))
	for key, sequence := range after {
		aggregateTypes = append(aggregateTypes, key.Type)
		aggregateIDs = append(aggregateIDs, key.ID)
		sequences = append(sequences, sequence)
	}
	var events []Event
	err := s.readTx(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, eventsQuery, instanceID, aggregateTypes, aggregateIDs, sequences, eventTypes)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var e Event
			if err := rows.Scan(&e.AggregateType, &e.AggregateID, &e.Type, &e.Sequence, &e.Position, &e.InTxOrder, &e.CreatedAt, &e.Owner, &e.Payload); err != nil {
				return err
			}
			events = append(events, e)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("read v4 events: %w", err)
	}
	return events, nil
}

// MaxPosition returns the position of the instance's newest event of the
// filtered types, "0" when there is none. status reports how far the cursor
// lags behind it.
func (s *Source) MaxPosition(ctx context.Context, instanceID string, filter TypeFilter) (string, error) {
	aggregateTypes, eventTypes := filter.columns()
	position := "0"
	err := s.readTx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT COALESCE(max(m.position), 0)::text
FROM unnest($2::text[], $3::text[]) AS scan(aggregate_type, event_type)
CROSS JOIN LATERAL (
	SELECT position FROM eventstore.events2
	WHERE instance_id = $1 AND aggregate_type = scan.aggregate_type AND event_type = scan.event_type
	ORDER BY position DESC
	LIMIT 1
) m`, instanceID, aggregateTypes, eventTypes).Scan(&position)
	})
	if err != nil {
		return "", fmt.Errorf("read the newest v4 position: %w", err)
	}
	return position, nil
}
