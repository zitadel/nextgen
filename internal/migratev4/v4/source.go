// Package v4 reads a Zitadel v4 database: its eventstore and its encryption
// keys. It only reads, in read-only transactions, and knows nothing of nextgen.
//
// How and why it reads the way it does: docs/design/migrate-v4/v4-source.md.
package v4

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// StepGapFree is the v4 setup step after which an event's position is stamped
// at insert time, behind the writer's lock (v4.18). From it on, a reader behind
// the barrier cannot miss an event while v4 keeps writing.
const StepGapFree = "77_eventstore_position_clock_timestamp"

// Source is a read-only connection to a Zitadel v4 database.
type Source struct {
	pool *pgxpool.Pool
}

// Open connects to the v4 database cfg points at.
func Open(ctx context.Context, cfg *pgxpool.Config) (*Source, error) {
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect to the v4 database: %w", err)
	}
	return &Source{pool: pool}, nil
}

func (s *Source) Close() {
	s.pool.Close()
}

// readTx runs fn in a READ COMMITTED, read-only transaction. READ COMMITTED
// matters for the barrier: each statement takes a fresh snapshot, so a select
// after the lock sees what the writers it waited for committed.
func (s *Source) readTx(ctx context.Context, fn func(pgx.Tx) error) error {
	return pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{
		IsoLevel:   pgx.ReadCommitted,
		AccessMode: pgx.ReadOnly,
	}, fn)
}

// Capabilities describes what the source's v4 version guarantees a reader.
type Capabilities struct {
	// Steps is every setup step v4 recorded as done.
	Steps map[string]bool
	// LastStep is the highest numbered of them, the best hint at the version
	// that last ran setup.
	LastStep string
	// GapFree reports whether reading while v4 runs cannot miss an event.
	GapFree bool
}

// Capabilities reads the setup steps v4 recorded as system events.
func (s *Source) Capabilities(ctx context.Context) (Capabilities, error) {
	caps := Capabilities{Steps: map[string]bool{}}
	err := s.readTx(ctx, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT to_regclass('eventstore.events2') IS NOT NULL`).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return errors.New("eventstore.events2 not found: not a Zitadel v4 database, or the role cannot read the eventstore schema")
		}
		rows, err := tx.Query(ctx, `
SELECT payload->>'name'
FROM eventstore.events2
WHERE instance_id = '' AND aggregate_type = 'system' AND event_type = 'system.migration.done'
ORDER BY position, in_tx_order`)
		if err != nil {
			return err
		}
		names, err := pgx.CollectRows(rows, pgx.RowTo[*string])
		if err != nil {
			return err
		}
		highest := -1
		for _, name := range names {
			if name == nil {
				continue
			}
			caps.Steps[*name] = true
			// Numbered steps run once; repeatable ones (projections) have no number.
			number, _, ok := strings.Cut(*name, "_")
			if n, err := strconv.Atoi(number); ok && err == nil && n > highest {
				highest, caps.LastStep = n, *name
			}
		}
		return nil
	})
	if err != nil {
		return Capabilities{}, fmt.Errorf("read v4 setup steps: %w", err)
	}
	caps.GapFree = caps.Steps[StepGapFree]
	return caps, nil
}

// Instance is a v4 instance as its lifecycle events describe it.
type Instance struct {
	ID      string
	Name    string
	Removed bool
}

// Instances lists the database's instances, removed ones included. The query
// hits v4's partial index on instance.added and instance.removed.
func (s *Source) Instances(ctx context.Context) ([]Instance, error) {
	var instances []Instance
	err := s.readTx(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT aggregate_id, event_type, COALESCE(payload->>'name', '')
FROM eventstore.events2
WHERE aggregate_type = 'instance' AND event_type IN ('instance.added', 'instance.removed')
ORDER BY position, in_tx_order`)
		if err != nil {
			return err
		}
		defer rows.Close()
		index := map[string]int{}
		for rows.Next() {
			var id, eventType, name string
			if err := rows.Scan(&id, &eventType, &name); err != nil {
				return err
			}
			i, ok := index[id]
			if !ok {
				i = len(instances)
				index[id] = i
				instances = append(instances, Instance{ID: id})
			}
			switch eventType {
			case "instance.added":
				instances[i].Name = name
				instances[i].Removed = false
			case "instance.removed":
				instances[i].Removed = true
			}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("list v4 instances: %w", err)
	}
	return instances, nil
}

// ChangeCounts counts the instance's events per aggregate and event type that
// someone wrote: setup writes its defaults (texts, policies, members) with an
// empty creator, so a fresh instance counts none of those. assess reports them
// for the settings the migrator does not read.
func (s *Source) ChangeCounts(ctx context.Context, instanceID string) (map[string]map[string]int64, error) {
	counts := map[string]map[string]int64{}
	err := s.readTx(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT aggregate_type, event_type, count(*)
FROM eventstore.events2
WHERE instance_id = $1 AND creator <> ''
GROUP BY aggregate_type, event_type`, instanceID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var aggregateType, eventType string
			var n int64
			if err := rows.Scan(&aggregateType, &eventType, &n); err != nil {
				return err
			}
			if counts[aggregateType] == nil {
				counts[aggregateType] = map[string]int64{}
			}
			counts[aggregateType][eventType] = n
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("count v4 events: %w", err)
	}
	return counts, nil
}
