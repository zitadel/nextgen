# Migration PoC — goose + Spanner

Design document for a proof-of-concept using [pressly/goose](https://github.com/pressly/goose) as the migration library against Google Spanner.

## Context

Continuing a design discussion from claude.ai. This doc captures the decisions and constraints so work can resume in Claude Code (or any other environment) without losing the thread.

## Requirements

- **Zero-downtime migrations** — no lock-induced outage windows; old and new app versions must coexist during schema changes.
- **Library integration** — migration logic called from Go code, no external binaries, no sidecar containers.
- **Single-binary deploy** — migrations embedded via `embed.FS` into the main app binary.
- **SQL-preferred** — SQL migration files, with escape hatch to Go code when SQL can't express what's needed (e.g., connection-mode settings).
- **Target: Google Spanner** — distributed SQL, regional nodes. GoogleSQL dialect assumed; PostgreSQL dialect is an option but doesn't change the analysis.

## Options considered and ruled out

| Option | Reason ruled out |
|---|---|
| **pgroll** | Runtime depends on PostgreSQL triggers, user-defined PL/pgSQL functions, per-session `search_path`, and transactional DDL. Spanner's PG interface provides none of these. Would require a full reimplementation of the core. |
| **tern** | Postgres-only by design, built directly on pgx. No Spanner support. |
| **Atlas** | Best-in-class Spanner support (GA Spanner driver, 50+ safety analyzers, declarative schema management), but the Go SDK (`atlasexec`) shells out to the `atlas` binary — violates the "no external binaries" constraint. |
| **golang-migrate** | Viable — being tested in parallel in `migration-design-golang-migrate.md`. |

## Why goose

- Pure Go library — no shelling out.
- `embed.FS` support — migrations compiled into the app binary.
- Native Spanner driver (`goose spanner ...`).
- **Supports Go-function migrations** via `goose.AddMigrationNoTxContext` — the key differentiator vs golang-migrate. Needed for anything that can't be expressed as SQL alone, such as `SET AUTOCOMMIT_DML_MODE='PARTITIONED_NON_ATOMIC'` before a large backfill.
- Single-file up/down migrations with `-- +goose Up` / `-- +goose Down` directives.

## Known limitations

- **No coordination on Spanner.** Goose has no built-in distributed lock. Multiple app replicas booting simultaneously will race on migration execution. Must be handled externally (see "Coordination" below).
- **Zero-downtime is manual.** Goose doesn't automate expand/contract — the migration author is responsible for writing backward-compatible migrations.
- **Spanner DDL is async.** `UpdateDatabaseDdl` RPCs aren't transactional. Every DDL-only migration needs `-- +goose NO TRANSACTION`.

## The expand/contract pattern

Zero-downtime on Spanner is a *migration authoring discipline*, not a library feature. The canonical pattern for breaking changes:

1. **Expand schema** — add new columns/tables as nullable, non-breaking.
2. **Dual-write deploy** — deploy app version that writes to both old and new columns, still reads from old.
3. **Backfill + swap reads** — backfill existing rows via Partitioned DML, add constraints, deploy app version that reads from new columns (still writes both).
4. **Contract schema** — drop old columns, deploy app version that stops writing them.

Between any two adjacent steps, both the previous and next app version must function correctly. That's the invariant that makes it zero-downtime.

## Worked example: splitting `name` into `first_name` + `last_name`

### Project layout

```
.
├── main.go
├── go.mod
└── migrations/
    ├── 00001_create_users.sql
    ├── 00002_expand_name_columns.sql
    ├── 00003_backfill_and_constrain_names.go
    └── 00004_drop_name.sql
```

### Migration runner

```go
package main

import (
    "context"
    "database/sql"
    "embed"
    "log"

    _ "github.com/googleapis/go-sql-spanner"
    "github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql migrations/*.go
var migrationsFS embed.FS

func runMigrations(ctx context.Context, dsn string) error {
    db, err := sql.Open("spanner", dsn)
    if err != nil {
        return err
    }
    defer db.Close()

    goose.SetBaseFS(migrationsFS)
    if err := goose.SetDialect("spanner"); err != nil {
        return err
    }

    release, err := acquireMigrationLock(ctx, db)
    if err != nil {
        return err
    }
    defer release()

    return goose.UpContext(ctx, db, "migrations")
}
```

### Migration 1 — create initial table

`migrations/00001_create_users.sql`:

```sql
-- +goose Up
-- +goose NO TRANSACTION
CREATE TABLE users (
  id    STRING(36) NOT NULL,
  name  STRING(255) NOT NULL,
) PRIMARY KEY (id);

-- +goose Down
-- +goose NO TRANSACTION
DROP TABLE users;
```

### Migration 2 — expand (add nullable columns)

`migrations/00002_expand_name_columns.sql`:

```sql
-- +goose Up
-- +goose NO TRANSACTION
ALTER TABLE users ADD COLUMN first_name STRING(255);
ALTER TABLE users ADD COLUMN last_name  STRING(255);

-- +goose Down
-- +goose NO TRANSACTION
ALTER TABLE users DROP COLUMN first_name;
ALTER TABLE users DROP COLUMN last_name;
```

**Deploy app v2 after this migration.** v2 writes `name`, `first_name`, `last_name` on every `INSERT`/`UPDATE`; still reads from `name`.

### Migration 3 — backfill via Partitioned DML (Go function)

`migrations/00003_backfill_and_constrain_names.go`:

```go
package migrations

import (
    "context"
    "database/sql"
    "fmt"

    "github.com/pressly/goose/v3"
)

func init() {
    goose.AddMigrationNoTxContext(upBackfillNames, downBackfillNames)
}

func upBackfillNames(ctx context.Context, db *sql.DB) error {
    conn, err := db.Conn(ctx)
    if err != nil {
        return err
    }
    defer conn.Close()

    if _, err := conn.ExecContext(ctx,
        "SET AUTOCOMMIT_DML_MODE='PARTITIONED_NON_ATOMIC'"); err != nil {
        return fmt.Errorf("enable partitioned DML: %w", err)
    }

    // WHERE clause ensures idempotency — Partitioned DML may re-execute
    // against a partition on retry. Rows already populated by app v2's
    // dual-writes are skipped.
    const backfill = `
        UPDATE users
        SET
          first_name = SPLIT(name, ' ')[OFFSET(0)],
          last_name  = IFNULL(SPLIT(name, ' ')[SAFE_OFFSET(1)], '')
        WHERE first_name IS NULL OR last_name IS NULL
    `
    res, err := conn.ExecContext(ctx, backfill)
    if err != nil {
        return fmt.Errorf("backfill: %w", err)
    }
    affected, _ := res.RowsAffected()
    goose.GetLogger().Printf("backfilled %d rows", affected)

    if _, err := conn.ExecContext(ctx,
        "SET AUTOCOMMIT_DML_MODE='TRANSACTIONAL'"); err != nil {
        return err
    }
    for _, stmt := range []string{
        "ALTER TABLE users ALTER COLUMN first_name STRING(255) NOT NULL",
        "ALTER TABLE users ALTER COLUMN last_name  STRING(255) NOT NULL",
    } {
        if _, err := conn.ExecContext(ctx, stmt); err != nil {
            return fmt.Errorf("alter: %w", err)
        }
    }
    return nil
}

func downBackfillNames(ctx context.Context, db *sql.DB) error {
    for _, stmt := range []string{
        "ALTER TABLE users ALTER COLUMN first_name STRING(255)",
        "ALTER TABLE users ALTER COLUMN last_name  STRING(255)",
    } {
        if _, err := db.ExecContext(ctx, stmt); err != nil {
            return err
        }
    }
    return nil
}
```

**Deploy app v3 after this migration.** v3 reads from `first_name`/`last_name`, still writes `name` too (rollback safety).

### Migration 4 — contract (drop old column)

`migrations/00004_drop_name.sql`:

```sql
-- +goose Up
-- +goose NO TRANSACTION
ALTER TABLE users DROP COLUMN name;

-- +goose Down
-- +goose NO TRANSACTION
ALTER TABLE users ADD COLUMN name STRING(255);
-- Caveat: rollback loses historical name data.
```

**Deploy app v4 before this migration.** v4 stops writing `name`. Run the drop only after all v3 instances are gone.

## Coordination

Goose has no built-in distributed lock. N replicas booting simultaneously will race on `goose.UpContext`. Two solutions:

### Option A — external runner (recommended)

Run migrations as a Cloud Run Job, Kubernetes `Job`, or Cloud Build step that executes before the app deploy. One execution, one runner, no race. Requires splitting the migration runner into a separate `main` package but keeps the coordination story simple.

### Option B — Spanner-backed lock table

If migrations must run from the app itself, use a singleton row in a lock table with a TTL-based lease:

```go
func acquireMigrationLock(ctx context.Context, db *sql.DB) (release func(), err error) {
    _, _ = db.ExecContext(ctx, `
        CREATE TABLE IF NOT EXISTS migration_lock (
          id         INT64 NOT NULL,
          holder     STRING(255),
          expires_at TIMESTAMP,
        ) PRIMARY KEY (id)
    `)

    holder := os.Getenv("HOSTNAME")
    tx, err := db.BeginTx(ctx, nil)
    if err != nil {
        return nil, err
    }

    _, err = tx.ExecContext(ctx, `
        INSERT OR UPDATE migration_lock (id, holder, expires_at)
        SELECT 1, @holder, TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 10 MINUTE)
        WHERE NOT EXISTS (
          SELECT 1 FROM migration_lock
          WHERE id = 1 AND expires_at > CURRENT_TIMESTAMP()
        )
    `, sql.Named("holder", holder))
    if err != nil {
        tx.Rollback()
        return nil, err
    }

    var actualHolder string
    if err := tx.QueryRowContext(ctx,
        `SELECT holder FROM migration_lock WHERE id = 1`,
    ).Scan(&actualHolder); err != nil {
        tx.Rollback()
        return nil, err
    }
    if actualHolder != holder {
        tx.Rollback()
        return nil, errors.New("another instance holds the migration lock")
    }
    if err := tx.Commit(); err != nil {
        return nil, err
    }

    release = func() {
        _, _ = db.ExecContext(context.Background(),
            `DELETE FROM migration_lock WHERE id = 1 AND holder = @holder`,
            sql.Named("holder", holder))
    }
    return release, nil
}
```

Rough sketch — production code needs TTL renewal for long migrations, exponential backoff for losers, and care around the crash-holder case (which is what the expiry handles).

## PoC next steps

1. **Scaffold the project** — `go mod init`, add `github.com/pressly/goose/v3` and `github.com/googleapis/go-sql-spanner`.
2. **Set up Spanner emulator** — use the official emulator in Docker for local testing. The `go-sql-spanner` driver supports `autoConfigEmulator=true` in the DSN for zero-setup local use.
3. **Implement migrations 1–4** as shown above.
4. **Test the happy path** — run migrations end-to-end against the emulator, verify final schema.
5. **Test the coordination story** — boot 3 processes simultaneously against the same emulator DB, verify only one runs the migration (validates Option B) or separate the migration runner entirely (validates Option A).
6. **Test the rollback path** — `goose.DownContext` for each migration, verify the down direction works.
7. **Stress-test migration 3** — seed ~100k rows with `name` values, run the backfill, verify idempotency by running it twice.
8. **Decision point** — compare ergonomics against the golang-migrate PoC and pick.

## Open questions for the PoC

- Does the `x-clean-statements` behaviour in golang-migrate have a goose equivalent? (Multi-statement DDL files — goose handles this via `-- +goose StatementBegin` / `-- +goose StatementEnd`.)
- How does goose handle DDL failures mid-migration on Spanner? (DDL is async and not transactional; a partial failure could leave the schema in an inconsistent state.)
- What's the rollback strategy when a Go-function migration partially succeeds? (The `down` function in migration 3 only reverses the `NOT NULL`, not the backfilled data — is that the right behaviour?)
