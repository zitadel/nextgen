package migration

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"time"

	"github.com/pressly/goose/v3"
	"github.com/zitadel/nextgen/internal/storage/dialect/idgen"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

//go:embed sql/*.sql
var sqlFiles embed.FS

const (
	// lockTable holds the single lease row that serializes Migrate across all
	// connections and processes sharing one database. Spanner has no advisory
	// locks (the postgres dialect uses pg_advisory_xact_lock), so mutual
	// exclusion is a claimed row instead. ensureLeaseRow creates the table and
	// row lazily on a migrator's first run against a database — deliberately
	// outside the goose chain, since the serialization must exist before goose
	// itself can run safely.
	lockTable = "zitadel_migration_lock"
	// leaseSeconds bounds how long a holder that died without releasing can
	// block other migrators; a live holder finishes and releases well within it.
	leaseSeconds = 600
	pollInterval = 1 * time.Second
	// bootstrapAttempts bounds the overlap retries of the one-time lease
	// bootstrap on a fresh database (see retryOverlap).
	bootstrapAttempts = 40
	// claimGrace is slept after winning the lease, before goose runs: the
	// emulator rejects a schema change while another schema change or a
	// read-write transaction is in flight (real Spanner queues instead), so
	// racers' final bootstrap/claim statements get time to drain first.
	claimGrace = time.Second
	// renewInterval refreshes acquired_at while the holder works, so the lease
	// outlives any long-running schema change (Spanner index backfills can run
	// far past a fixed window). Kept much longer than an emulator migration
	// takes end to end, so a renewal's read-write transaction never overlaps
	// the holder's own DDL there (which the emulator would reject).
	renewInterval = 60 * time.Second
)

// Migrate applies all pending migrations to db. It is idempotent:
// already-applied migrations are skipped.
//
// Concurrent callers — parallel test packages sharing one database, or several
// nodes starting at once — are serialized with a lease row in lockTable:
// goose's Up is not concurrency-safe, so two concurrent runs can both see a
// migration as pending and race its DDL (plain CREATE TABLE, no IF NOT
// EXISTS) or the goose_db_version bookkeeping insert. Waiters poll the lease
// with read-only queries only; on the emulator a read-write transaction in
// flight would make the holder's DDL fail.
//
// The holder renews the lease while goose runs, so schema changes that outlive
// leaseSeconds keep their lease, and goose executes under a fencing context:
// the moment holdership can no longer be proven — another holder took the row,
// or renewal failed for a full lease window — the context is canceled and the
// fenced holder stops instead of racing its successor.
func Migrate(ctx context.Context, db *sql.DB) (err error) {
	holder, err := holderID()
	if err != nil {
		return err
	}
	if err := acquireLease(ctx, db, holder); err != nil {
		return err
	}

	fenced, cancel := context.WithCancelCause(ctx)
	renewerDone := make(chan struct{})
	go renewLease(fenced, db, holder, cancel, renewerDone)
	defer func() {
		cancel(nil)
		<-renewerDone
		err = errors.Join(err, releaseLease(ctx, db, holder))
	}()

	sqlFS, err := fs.Sub(sqlFiles, "sql")
	if err != nil {
		return err
	}
	// batchDDLFS brackets each run of consecutive DDL with START BATCH DDL /
	// RUN BATCH, so those statements reach Spanner as one UpdateDatabaseDdl
	// instead of one per statement (#973). goose just executes what it reads.
	// See ddl_batch.go.
	//
	// WithIsolateDDL runs DDL statements outside transactions, which Spanner requires.
	p, err := goose.NewProvider(goose.DialectSpanner, db, batchDDLFS{inner: sqlFS}, goose.WithIsolateDDL(true))
	if err != nil {
		return err
	}
	_, upErr := p.Up(fenced)
	if cause := context.Cause(fenced); cause != nil && !errors.Is(cause, context.Canceled) {
		return errors.Join(upErr, fmt.Errorf("migration fenced off: %w", cause))
	}
	return upErr
}

// renewLease periodically re-stamps acquired_at for holder until ctx ends. If
// the row no longer names holder, or renewal keeps failing past a full lease
// window (so expiry can no longer be ruled out), it cancels the fencing
// context with the reason and returns.
func renewLease(ctx context.Context, db *sql.DB, holder string, cancel context.CancelCauseFunc, done chan<- struct{}) {
	defer close(done)
	renew := fmt.Sprintf(
		"UPDATE %s SET acquired_at = CURRENT_TIMESTAMP() WHERE id = 1 AND holder = @holder",
		lockTable,
	)
	ticker := time.NewTicker(renewInterval)
	defer ticker.Stop()
	lastConfirmed := time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		res, err := db.ExecContext(ctx, renew, sql.Named("holder", holder))
		if err == nil {
			if n, raErr := res.RowsAffected(); raErr == nil {
				if n == 1 {
					lastConfirmed = time.Now()
					continue
				}
				cancel(errors.New("migration lease lost to another holder"))
				return
			}
		}
		// Transient renewal failures are tolerated while the lease provably
		// cannot have expired yet.
		if time.Since(lastConfirmed) > leaseSeconds*time.Second {
			cancel(fmt.Errorf("migration lease renewal failed for over %d seconds: %w", int(leaseSeconds), err))
			return
		}
	}
}

// holderID returns a unique identity for this Migrate call, so releases and
// lease reclaims only ever touch our own claim.
func holderID() (string, error) {
	id, err := idgen.NewULID().New("mig")
	if err != nil {
		return "", fmt.Errorf("generate migration lease holder id: %w", err)
	}
	return id, nil
}

// acquireLease blocks until this holder owns the lease row, bounded by ctx.
// It polls read-only and only attempts the read-write claim when the lease
// looks free or expired, so waiting migrators put no read-write transactions
// in flight while the holder runs DDL.
func acquireLease(ctx context.Context, db *sql.DB, holder string) error {
	if err := ensureLeaseRow(ctx, db); err != nil {
		return err
	}
	free := fmt.Sprintf(
		"SELECT COUNT(*) FROM %s WHERE id = 1 AND (holder = '' OR holder = @holder OR acquired_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL %d SECOND))",
		lockTable, leaseSeconds,
	)
	claim := fmt.Sprintf(
		"UPDATE %s SET holder = @holder, acquired_at = CURRENT_TIMESTAMP() WHERE id = 1 AND (holder = '' OR holder = @holder OR acquired_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL %d SECOND))",
		lockTable, leaseSeconds,
	)
	for {
		var n int64
		if err := db.QueryRowContext(ctx, free, sql.Named("holder", holder)).Scan(&n); err != nil {
			return fmt.Errorf("poll migration lease: %w", err)
		}
		if n == 1 {
			res, err := db.ExecContext(ctx, claim, sql.Named("holder", holder))
			switch {
			case status.Code(err) == codes.FailedPrecondition:
				// Overlapped a racer's bootstrap DDL (emulator-only); poll again.
			case err != nil:
				return fmt.Errorf("claim migration lease: %w", err)
			default:
				claimed, err := res.RowsAffected()
				if err != nil {
					return err
				}
				if claimed == 1 {
					// The claim is a conditional single statement, so losing
					// racers see the row as held and go back to polling.
					return wait(ctx, claimGrace)
				}
			}
		}
		if err := wait(ctx, pollInterval); err != nil {
			return err
		}
	}
}

// ensureLeaseRow bootstraps the lease table and its single row, check-first:
// once both exist every later Migrate gets through on read-only queries alone,
// issuing no DDL or DML that could collide with an active holder's migration.
func ensureLeaseRow(ctx context.Context, db *sql.DB) error {
	var tables int64
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '' AND TABLE_NAME = @table",
		sql.Named("table", lockTable),
	).Scan(&tables); err != nil {
		return fmt.Errorf("check migration lease table: %w", err)
	}
	if tables == 0 {
		err := retryOverlap(ctx, func() error {
			_, err := db.ExecContext(ctx,
				"CREATE TABLE IF NOT EXISTS "+lockTable+" (id INT64 NOT NULL, holder STRING(64) NOT NULL, acquired_at TIMESTAMP NOT NULL) PRIMARY KEY (id)",
			)
			return err
		})
		if err != nil {
			return fmt.Errorf("create migration lease table: %w", err)
		}
	}
	var rows int64
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+lockTable+" WHERE id = 1").Scan(&rows); err != nil {
		return fmt.Errorf("check migration lease row: %w", err)
	}
	if rows == 0 {
		err := retryOverlap(ctx, func() error {
			_, err := db.ExecContext(ctx,
				"INSERT OR IGNORE INTO "+lockTable+" (id, holder, acquired_at) VALUES (1, '', TIMESTAMP_SECONDS(0))",
			)
			return err
		})
		if err != nil {
			return fmt.Errorf("seed migration lease row: %w", err)
		}
	}
	return nil
}

// retryOverlap retries fn while it fails with FailedPrecondition: the emulator
// rejects a schema change or read-write transaction that overlaps an in-flight
// schema change (real Spanner queues them instead), and simultaneous lease
// bootstraps on a fresh database race exactly there. Both bootstrap statements
// are idempotent (IF NOT EXISTS / OR IGNORE), so retrying is safe.
func retryOverlap(ctx context.Context, fn func() error) error {
	var err error
	for attempt := 0; attempt < bootstrapAttempts; attempt++ {
		if err = fn(); err == nil || status.Code(err) != codes.FailedPrecondition {
			return err
		}
		if werr := wait(ctx, pollInterval); werr != nil {
			return errors.Join(err, werr)
		}
	}
	return err
}

// releaseLease frees the lease row if this holder still owns it. WithoutCancel
// so a canceled ctx cannot skip the release — an unreleased lease blocks other
// migrators until it expires.
func releaseLease(ctx context.Context, db *sql.DB, holder string) error {
	if _, err := db.ExecContext(context.WithoutCancel(ctx),
		"UPDATE "+lockTable+" SET holder = '' WHERE id = 1 AND holder = @holder",
		sql.Named("holder", holder),
	); err != nil {
		return fmt.Errorf("release migration lease: %w", err)
	}
	return nil
}

func wait(ctx context.Context, d time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(d):
		return nil
	}
}
