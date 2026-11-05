package v4test

import (
	"compress/gzip"
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v5/pgxpool"
)

// LoadFixture copies a recorded v4 instance into pool: the events and keys
// demo/record-fixtures.sh dumped from a real v4 into dir (events.csv.gz,
// keys.csv). It creates the tables first, so pool may be a fresh database.
func LoadFixture(ctx context.Context, pool *pgxpool.Pool, dir string) error {
	if err := CreateSchema(ctx, pool); err != nil {
		return err
	}
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	events, err := os.Open(filepath.Join(dir, "events.csv.gz"))
	if err != nil {
		return err
	}
	defer events.Close()
	unzipped, err := gzip.NewReader(events)
	if err != nil {
		return fmt.Errorf("%s: %w", events.Name(), err)
	}
	if _, err := conn.Conn().PgConn().CopyFrom(ctx, unzipped,
		`COPY eventstore.events2 (instance_id, aggregate_type, aggregate_id, event_type, "sequence", revision, created_at, payload, creator, "owner", "position", in_tx_order) FROM STDIN WITH (FORMAT csv)`); err != nil {
		return fmt.Errorf("load %s: %w", events.Name(), err)
	}

	keys, err := os.Open(filepath.Join(dir, "keys.csv"))
	if err != nil {
		return err
	}
	defer keys.Close()
	if _, err := conn.Conn().PgConn().CopyFrom(ctx, keys,
		`COPY system.encryption_keys (id, key) FROM STDIN WITH (FORMAT csv)`); err != nil {
		return fmt.Errorf("load %s: %w", keys.Name(), err)
	}
	return nil
}
