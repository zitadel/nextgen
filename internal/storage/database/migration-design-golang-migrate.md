# Migration PoC — golang-migrate + Spanner

Design document for a proof-of-concept using [golang-migrate/migrate](https://github.com/golang-migrate/migrate) as the migration library against Google Spanner.

## Context

Continuing a design discussion from claude.ai. This doc captures the decisions and constraints so work can resume in Claude Code (or any other environment) without losing the thread.

## Requirements

- **Zero-downtime migrations** — no lock-induced outage windows; old and new app versions must coexist during schema changes.
- **Library integration** — migration logic called from Go code, no external binaries, no sidecar containers.
- **Single-binary deploy** — migrations embedded via `embed.FS` into the main app binary.
- **SQL-only** — golang-migrate doesn't support Go-function migrations. Anything that can't be expressed as SQL must be handled outside the migration tool (see "Handling backfills" below).
- **Target: Google Spanner** — distributed SQL, regional nodes. GoogleSQL dialect assumed.

## Options considered and ruled out

| Option | Reason ruled out |
|---|---|
| **pgroll** | Runtime depends on PostgreSQL triggers, user-defined PL/pgSQL functions, per-session `search_path`, and transactional DDL. Spanner's PG interface provides none of these. |
| **tern** | Postgres-only by design, built directly on pgx. No Spanner support. |
| **Atlas** | Best-in-class Spanner support, but the Go SDK (`atlasexec`) shells out to the `atlas` binary — violates the "no external binaries" constraint. |
| **goose** | Viable — being tested in parallel in `migration-design-goose.md`. |

## Why golang-migrate

- Pure Go library — `migrate.NewWithInstance` / `migrate.NewWithSourceInstance`, no shelling out.
- `embed.FS` support via the `iofs` source driver.
- Native Spanner driver.
- Larger community, more mindshare, more Stack Overflow coverage.
- Separate `.up.sql` / `.down.sql` files — shorter, purpose-specific files (taste preference).

## Known limitations

- **No Go-function migrations.** SQL only. Anything requiring connection-mode settings (like `SET AUTOCOMMIT_DML_MODE='PARTITIONED_NON_ATOMIC'` for large backfills) must be handled outside the migration runner. This is arguably cleaner architecturally — backfills live in regular deploy code — but is a hard constraint of the tool.
- **Lock is a no-op on Spanner.** The [Spanner driver docs](https://pkg.go.dev/github.com/golang-migrate/migrate/v4/database/spanner) explicitly state: "Lock implements database.Driver but doesn't do anything because Spanner only enqueues the UpdateDatabaseDdlRequest." N replicas booting simultaneously will race on migration execution. Must be handled externally.
- **`x-clean-statements` required.** For migration files with SQL comments or multiple DDL statements, the DSN must include `x-clean-statements=true`. This makes the driver parse each file through `spansql` before submission, stripping comments and splitting statements.
- **Zero-downtime is manual.** Same as every non-pgroll option.
- **Spanner DDL is async.** DDL migrations can't be wrapped in transactions. Each file should contain only DDL (no mixed DML).

## The expand/contract pattern

Zero-downtime on Spanner is a *migration authoring discipline*, not a library feature. The canonical pattern for breaking changes:

1. **Expand schema** — add new columns/tables as nullable, non-breaking.
2. **Dual-write deploy** — deploy app version that writes to both old and new columns, still reads from old.
3. **Backfill + swap reads** — backfill existing rows (outside the migration tool — see below), add constraints via migration, deploy app version that reads from new columns.
4. **Contract schema** — drop old columns, deploy app version that stops writing them.

Between any two adjacent steps, both the previous and next app version must function correctly. That's the invariant that makes it zero-downtime.

## Handling backfills outside the migration tool

Since golang-migrate can't express Partitioned DML in a SQL file (it's a connection-mode setting, not a statement), backfills are handled as a separate step in the deploy pipeline:

```
Deploy sequence for the "backfill phase":
  1. Run `migrate.Up()` → applies migration 3a (pre-backfill DDL, e.g., any helper columns)
  2. Run separate backfill Go function (uses Partitioned DML directly)
  3. Run `migrate.Up()` → applies migration 3b (post-backfill DDL, e.g., NOT NULL constraints)
  4. Deploy app v3
```

Arguably this is cleaner than embedding backfill logic in a migration file: the backfill lives in your regular deploy code, gets the same observability as other Go code, and isn't tied to the migration tool's lifecycle.

## Worked example: splitting `name` into `first_name` + `last_name`

### Project layout

```
.
├── main.go
├── backfill.go
├── go.mod
└── migrations/
    ├── 000001_create_users.up.sql
    ├── 000001_create_users.down.sql
    ├── 000002_expand_name_columns.up.sql
    ├── 000002_expand_name_columns.down.sql
    ├── 000003_constrain_names.up.sql
    └── 000003_constrain_names.down.sql
    ├── 000004_drop_name.up.sql
    └── 000004_drop_name.down.sql
```

Note: there's no migration file for the backfill itself — it runs as a separate Go function between migrations 2 and 3.

### Migration runner

```go
package main

import (
    "context"
    "database/sql"
    "embed"
    "log"

    _ "github.com/googleapis/go-sql-spanner"
    "github.com/golang-migrate/migrate/v4"
    "github.com/golang-migrate/migrate/v4/database/spanner"
    "github.com/golang-migrate/migrate/v4/source/iofs"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

func runMigrations(ctx context.Context, dsn string) error {
    src, err := iofs.New(migrationsFS, "migrations")
    if err != nil {
        return err
    }

    // x-clean-statements=true is required for multi-statement DDL files.
    spannerURL := "spanner://" + dsn + "?x-clean-statements=true"
    m, err := migrate.NewWithSourceInstance("iofs", src, spannerURL)
    if err != nil {
        return err
    }
    defer m.Close()

    release, err := acquireMigrationLock(ctx, dsn)
    if err != nil {
        return err
    }
    defer release()

    if err := m.Up(); err != nil && err != migrate.ErrNoChange {
        return err
    }
    return nil
}
```

### Migration 1 — create initial table

`migrations/000001_create_users.up.sql`:

```sql
CREATE TABLE users (
  id    STRING(36) NOT NULL,
  name  STRING(255) NOT NULL,
) PRIMARY KEY (id);
```

`migrations/000001_create_users.down.sql`:

```sql
DROP TABLE users;
```

### Migration 2 — expand (add nullable columns)

`migrations/000002_expand_name_columns.up.sql`:

```sql
ALTER TABLE users ADD COLUMN first_name STRING(255);
ALTER TABLE users ADD COLUMN last_name  STRING(255);
```

`migrations/000002_expand_name_columns.down.sql`:

```sql
ALTER TABLE users DROP COLUMN first_name;
ALTER TABLE users DROP COLUMN last_name;
```

**Deploy app v2 after this migration.** v2 writes `name`, `first_name`, `last_name` on every `INSERT`/`UPDATE`; still reads from `name`.

### The backfill (separate Go function, not a migration)

`backfill.go`:

```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "log"
)

func backfillNames(ctx context.Context, dsn string) error {
    db, err := sql.Open("spanner", dsn)
    if err != nil {
        return err
    }
    defer db.Close()

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
    log.Printf("backfilled %d rows", affected)
    return nil
}
```

This is invoked from the deploy pipeline between migrations 2 and 3 — **not** via `migrate.Up()`. Your deploy script does something like:

```
go run ./cmd/migrate -up-to 2   # applies migrations 1 and 2
go run ./cmd/backfill            # runs the partitioned DML
go run ./cmd/migrate -up-to 3   # applies migration 3 (NOT NULL)
```

### Migration 3 — constrain (add NOT NULL after backfill)

`migrations/000003_constrain_names.up.sql`:

```sql
ALTER TABLE users ALTER COLUMN first_name STRING(255) NOT NULL;
ALTER TABLE users ALTER COLUMN last_name  STRING(255) NOT NULL;
```

`migrations/000003_constrain_names.down.sql`:

```sql
ALTER TABLE users ALTER COLUMN first_name STRING(255);
ALTER TABLE users ALTER COLUMN last_name  STRING(255);
```

**Deploy app v3 after this migration.** v3 reads from `first_name`/`last_name`, still writes `name` too.

### Migration 4 — contract (drop old column)

`migrations/000004_drop_name.up.sql`:

```sql
ALTER TABLE users DROP COLUMN name;
```

`migrations/000004_drop_name.down.sql`:

```sql
ALTER TABLE users ADD COLUMN name STRING(255);
-- Caveat: rollback loses historical name data.
```

**Deploy app v4 before this migration.** v4 stops writing `name`. Run the drop only after all v3 instances are gone.

## Coordination

golang-migrate's `Lock`/`Unlock` are no-ops on Spanner (documented behaviour). N replicas booting simultaneously will race on migration execution. Two solutions:

### Option A — external runner (recommended)

Run migrations as a Cloud Run Job, Kubernetes `Job`, or Cloud Build step that executes before the app deploy. One execution, one runner, no race. This pairs especially well with golang-migrate because the backfill is already a separate step — you're already splitting migration concerns out of the app.

### Option B — Spanner-backed lock table

If migrations must run from the app itself, use a singleton row in a lock table with a TTL-based lease:

```go
func acquireMigrationLock(ctx context.Context, dsn string) (release func(), err error) {
    db, err := sql.Open("spanner", dsn)
    if err != nil {
        return nil, err
    }

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
        db.Close()
    }
    return release, nil
}
```

Rough sketch — production code needs TTL renewal for long migrations, exponential backoff for losers, and care around the crash-holder case.

## PoC next steps

1. **Scaffold the project** — `go mod init`, add `github.com/golang-migrate/migrate/v4`, `github.com/golang-migrate/migrate/v4/database/spanner`, `github.com/golang-migrate/migrate/v4/source/iofs`, `github.com/googleapis/go-sql-spanner`.
2. **Set up Spanner emulator** — use the official emulator in Docker for local testing. The `go-sql-spanner` driver supports `autoConfigEmulator=true` in the DSN.
3. **Implement migrations 1–4** as shown above, plus the separate `backfill.go`.
4. **Test the happy path** — run the full sequence (migrate up-to 2 → backfill → migrate up-to 3 → migrate up-to 4), verify final schema.
5. **Test the coordination story** — boot 3 processes simultaneously against the same emulator DB, verify only one runs the migration (validates Option B) or separate the migration runner entirely (validates Option A).
6. **Test the rollback path** — `m.Down()` or `m.Steps(-1)` for each migration, verify down direction works.
7. **Stress-test the backfill** — seed ~100k rows with `name` values, run the backfill, verify idempotency by running it twice.
8. **Decision point** — compare ergonomics against the goose PoC and pick.

## Open questions for the PoC

- Does `x-clean-statements=true` handle Spanner-specific DDL syntax cleanly (e.g., `INTERLEAVE IN PARENT`, change streams, locality groups)? The `spansql` parser may or may not track the latest Spanner DDL features.
- How does the split-file format (`.up.sql` / `.down.sql`) scale with many migrations — is the 2x file count a real pain in practice, or does it help with reviewability?
- What's the rollback story when the backfill partially completes? (The backfill isn't a migration, so `m.Down()` doesn't know about it. If migration 3 fails after a successful backfill, you need to handle that manually.)
- Does the deploy pipeline's multi-step sequence (migrate → backfill → migrate) cause problems with the lock — do you hold it across all three steps, or re-acquire each time?
