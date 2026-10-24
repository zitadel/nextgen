// Package stage keeps the migrator's state: how far it read v4, the folded v4
// state per aggregate, and which nextgen resource each v4 source became. It is
// Postgres-only, in its own schema beside nextgen's tables (plan, D8).
package stage

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	v4 "github.com/zitadel/nextgen/internal/migratev4/v4"
)

//go:embed schema.sql
var schemaSQL string

// Store is the migrator's state in the zitadel_migrate_v4 schema.
type Store struct {
	pool *pgxpool.Pool
}

// Open connects to the database that holds the migrator's state.
func Open(ctx context.Context, cfg *pgxpool.Config) (*Store, error) {
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect to the migration ledger: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() {
	s.pool.Close()
}

// Migrate creates the schema and its tables when missing.
func (s *Store) Migrate(ctx context.Context) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('zitadel_migrate_v4'))`); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, schemaSQL); err != nil {
			return fmt.Errorf("create the migration ledger: %w", err)
		}
		return nil
	})
}

// Lock makes this process the only migrator of the instance until the
// returned func runs. It holds a session lock on a connection of its own.
func (s *Store) Lock(ctx context.Context, instanceID string) (func(), error) {
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	var locked bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtext('zitadel_migrate_v4'), hashtext($1))`, instanceID).Scan(&locked); err != nil {
		conn.Release()
		return nil, err
	}
	if !locked {
		conn.Release()
		return nil, fmt.Errorf("another migrate-v4 is running for instance %s", instanceID)
	}
	return func() {
		_, _ = conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock(hashtext('zitadel_migrate_v4'), hashtext($1))`, instanceID)
		conn.Release()
	}, nil
}

// Cursor returns how far ingest has read the instance, and with which
// version of the reducers.
func (s *Store) Cursor(ctx context.Context, instanceID string) (v4.Cursor, int, error) {
	var c v4.Cursor
	var version int
	err := s.pool.QueryRow(ctx, `
SELECT position::text, in_tx_order, aggregate_type, aggregate_id, sequence, reducer_version
FROM zitadel_migrate_v4.cursors WHERE instance_id = $1`, instanceID).
		Scan(&c.Position, &c.InTxOrder, &c.AggregateType, &c.AggregateID, &c.Sequence, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return v4.Start, ReducerVersion, nil
	}
	if err != nil {
		return v4.Cursor{}, 0, fmt.Errorf("read the cursor: %w", err)
	}
	return c, version, nil
}

// ResetStage forgets what was folded for the instance, so the next ingest
// reads v4 from the start. The id map stays: what nextgen holds is unchanged.
func (s *Store) ResetStage(ctx context.Context, instanceID string) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM zitadel_migrate_v4.cursors WHERE instance_id = $1`, instanceID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM zitadel_migrate_v4.aggregates WHERE instance_id = $1`, instanceID)
		return err
	})
}

// Load returns the staged aggregates for keys. A key never staged gets an
// empty document at sequence zero.
func (s *Store) Load(ctx context.Context, instanceID string, keys []v4.AggregateKey) (map[v4.AggregateKey]*Staged, error) {
	staged := make(map[v4.AggregateKey]*Staged, len(keys))
	types := make([]string, 0, len(keys))
	ids := make([]string, 0, len(keys))
	for _, key := range keys {
		doc := NewDoc(key.Type)
		if doc == nil {
			return nil, fmt.Errorf("the stage does not fold %s aggregates", key.Type)
		}
		staged[key] = &Staged{Key: key, Doc: doc}
		types = append(types, key.Type)
		ids = append(ids, key.ID)
	}
	rows, err := s.pool.Query(ctx, `
SELECT a.aggregate_type, a.aggregate_id, a.sequence, a.doc
FROM zitadel_migrate_v4.aggregates a
JOIN unnest($2::text[], $3::text[]) AS k(aggregate_type, aggregate_id)
	ON a.aggregate_type = k.aggregate_type AND a.aggregate_id = k.aggregate_id
WHERE a.instance_id = $1`, instanceID, types, ids)
	if err != nil {
		return nil, fmt.Errorf("load staged aggregates: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var key v4.AggregateKey
		var sequence int64
		var doc []byte
		if err := rows.Scan(&key.Type, &key.ID, &sequence, &doc); err != nil {
			return nil, err
		}
		st := staged[key]
		st.Sequence = sequence
		if err := json.Unmarshal(doc, st.Doc); err != nil {
			return nil, fmt.Errorf("decode staged %s %s: %w", key.Type, key.ID, err)
		}
	}
	return staged, rows.Err()
}

// Save writes the staged aggregates and moves the cursor in one transaction,
// so a batch is staged entirely or not at all.
func (s *Store) Save(ctx context.Context, instanceID string, staged []*Staged, cursor v4.Cursor) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		batch := &pgx.Batch{}
		for _, st := range staged {
			doc, err := json.Marshal(st.Doc)
			if err != nil {
				return err
			}
			batch.Queue(`
INSERT INTO zitadel_migrate_v4.aggregates (instance_id, aggregate_type, aggregate_id, sequence, doc)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (instance_id, aggregate_type, aggregate_id)
DO UPDATE SET sequence = EXCLUDED.sequence, doc = EXCLUDED.doc, updated_at = now()`,
				instanceID, st.Key.Type, st.Key.ID, st.Sequence, doc)
		}
		batch.Queue(`
INSERT INTO zitadel_migrate_v4.cursors (instance_id, position, in_tx_order, aggregate_type, aggregate_id, sequence, reducer_version)
VALUES ($1, $2::numeric, $3, $4, $5, $6, $7)
ON CONFLICT (instance_id) DO UPDATE SET
	position = EXCLUDED.position, in_tx_order = EXCLUDED.in_tx_order,
	aggregate_type = EXCLUDED.aggregate_type, aggregate_id = EXCLUDED.aggregate_id,
	sequence = EXCLUDED.sequence, reducer_version = EXCLUDED.reducer_version, updated_at = now()`,
			instanceID, cursor.Position, cursor.InTxOrder, cursor.AggregateType, cursor.AggregateID, cursor.Sequence, ReducerVersion)
		if err := tx.SendBatch(ctx, batch).Close(); err != nil {
			return fmt.Errorf("save staged aggregates: %w", err)
		}
		return nil
	})
}

// All returns every staged aggregate of the type.
func (s *Store) All(ctx context.Context, instanceID, aggregateType string) ([]*Staged, error) {
	rows, err := s.pool.Query(ctx, `
SELECT aggregate_id, sequence, doc FROM zitadel_migrate_v4.aggregates
WHERE instance_id = $1 AND aggregate_type = $2
ORDER BY aggregate_id`, instanceID, aggregateType)
	if err != nil {
		return nil, fmt.Errorf("list staged %s aggregates: %w", aggregateType, err)
	}
	defer rows.Close()
	var all []*Staged
	for rows.Next() {
		st := &Staged{Key: v4.AggregateKey{Type: aggregateType}, Doc: NewDoc(aggregateType)}
		var doc []byte
		if err := rows.Scan(&st.Key.ID, &st.Sequence, &doc); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(doc, st.Doc); err != nil {
			return nil, fmt.Errorf("decode staged %s %s: %w", aggregateType, st.Key.ID, err)
		}
		all = append(all, st)
	}
	return all, rows.Err()
}

// ---- id map ----------------------------------------------------------------

// Mapping records which nextgen resource a v4 source became.
type Mapping struct {
	SourceKind string
	SourceID   string
	TargetID   string
	// Applied is false while the id is only reserved: nextgen may or may not
	// hold the resource yet.
	Applied         bool
	AppliedSequence int64
	// Fingerprint hashes what the migrator last wrote, to skip unchanged
	// sources and to notice edits made in nextgen since.
	Fingerprint string
}

// MappingKey identifies a mapping within an instance.
type MappingKey struct {
	Kind string
	ID   string
}

// Mappings returns every mapping of the instance.
func (s *Store) Mappings(ctx context.Context, instanceID string) (map[MappingKey]*Mapping, error) {
	rows, err := s.pool.Query(ctx, `
SELECT source_kind, source_id, target_id, status = 'applied', applied_sequence, fingerprint
FROM zitadel_migrate_v4.id_map WHERE instance_id = $1`, instanceID)
	if err != nil {
		return nil, fmt.Errorf("read the id map: %w", err)
	}
	defer rows.Close()
	mappings := map[MappingKey]*Mapping{}
	for rows.Next() {
		m := &Mapping{}
		if err := rows.Scan(&m.SourceKind, &m.SourceID, &m.TargetID, &m.Applied, &m.AppliedSequence, &m.Fingerprint); err != nil {
			return nil, err
		}
		mappings[MappingKey{Kind: m.SourceKind, ID: m.SourceID}] = m
	}
	return mappings, rows.Err()
}

// Reserve records the target id before anything is written to nextgen. It
// keeps an existing reservation, so a retry writes under the same id.
func (s *Store) Reserve(ctx context.Context, instanceID string, m *Mapping) error {
	err := s.pool.QueryRow(ctx, `
INSERT INTO zitadel_migrate_v4.id_map (instance_id, source_kind, source_id, target_id, status)
VALUES ($1, $2, $3, $4, 'reserved')
ON CONFLICT (instance_id, source_kind, source_id) DO UPDATE SET source_kind = EXCLUDED.source_kind
RETURNING target_id, status = 'applied'`, instanceID, m.SourceKind, m.SourceID, m.TargetID).Scan(&m.TargetID, &m.Applied)
	if err != nil {
		return fmt.Errorf("reserve an id for %s %s: %w", m.SourceKind, m.SourceID, err)
	}
	return nil
}

// MarkApplied records that nextgen holds what the mapping's fingerprint
// describes, at the given v4 sequence.
func (s *Store) MarkApplied(ctx context.Context, instanceID string, m *Mapping) error {
	_, err := s.pool.Exec(ctx, `
UPDATE zitadel_migrate_v4.id_map
SET status = 'applied', applied_sequence = $4, fingerprint = $5, target_id = $6, updated_at = now()
WHERE instance_id = $1 AND source_kind = $2 AND source_id = $3`,
		instanceID, m.SourceKind, m.SourceID, m.AppliedSequence, m.Fingerprint, m.TargetID)
	if err != nil {
		return fmt.Errorf("mark %s %s applied: %w", m.SourceKind, m.SourceID, err)
	}
	m.Applied = true
	return nil
}

// ---- runs and cleanup ------------------------------------------------------

// SaveRun records a command run and the report it printed.
func (s *Store) SaveRun(ctx context.Context, instanceID, command string, started time.Time, report any) error {
	doc, err := json.Marshal(report)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
INSERT INTO zitadel_migrate_v4.runs (instance_id, command, started_at, report) VALUES ($1, $2, $3, $4)`,
		instanceID, command, started, doc)
	if err != nil {
		return fmt.Errorf("record the run: %w", err)
	}
	return nil
}

// LastRun returns the newest run's command, time and report, nil if none.
func (s *Store) LastRun(ctx context.Context, instanceID string) (command string, finished time.Time, report []byte, err error) {
	err = s.pool.QueryRow(ctx, `
SELECT command, finished_at, report FROM zitadel_migrate_v4.runs
WHERE instance_id = $1 ORDER BY id DESC LIMIT 1`, instanceID).Scan(&command, &finished, &report)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", time.Time{}, nil, nil
	}
	return command, finished, report, err
}

// DropInstance deletes everything the migrator kept for the instance. The
// nextgen resources it created stay.
func (s *Store) DropInstance(ctx context.Context, instanceID string) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		for _, statement := range []string{
			`DELETE FROM zitadel_migrate_v4.cursors WHERE instance_id = $1`,
			`DELETE FROM zitadel_migrate_v4.aggregates WHERE instance_id = $1`,
			`DELETE FROM zitadel_migrate_v4.id_map WHERE instance_id = $1`,
			`DELETE FROM zitadel_migrate_v4.runs WHERE instance_id = $1`,
		} {
			if _, err := tx.Exec(ctx, statement, instanceID); err != nil {
				return err
			}
		}
		return nil
	})
}
