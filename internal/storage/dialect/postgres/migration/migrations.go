package migration

import (
	"bytes"
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io"
	"io/fs"

	"github.com/pressly/goose/v3"

	pgschema "github.com/zitadel/nextgen/internal/storage/dialect/postgres/schema"
)

//go:embed sql/*.sql
var sqlFiles embed.FS

// migrationLockID keys the session advisory lock that serializes Migrate
// across all connections and processes sharing one database. Arbitrary but
// stable: "zitadel" in hex.
const migrationLockID = int64(0x7a69746164656c)

// extensions are the extensions the migrations rely on. Postgres installs an
// extension once per database, not per schema: in the default schema the
// migrations create them where the connection's search_path points, every
// other schema pins them to public so that all schemas of the database share
// them and resolve their functions through the search_path.
var extensions = []string{"btree_gin", "pgcrypto"}

// Migrate applies all pending migrations to db in the default schema. See
// MigrateInto.
func Migrate(ctx context.Context, db *sql.DB) error {
	return MigrateInto(ctx, db, pgschema.Default)
}

// MigrateInto applies all pending migrations to db under schema. It is
// idempotent: already-applied migrations are skipped. The schema is created
// if it does not exist, since the goose tracking table lives there.
//
// The migrations are written for [pgschema.Default]. For any other schema
// they are rewritten before goose reads them, so the tables, the types and
// the tracking table all land in that schema and the default schema is left
// alone.
//
// Concurrent callers — parallel test packages sharing one database, or several
// nodes starting at once — are serialized with the same session advisory lock
// for schema creation and goose's run: two concurrent goose runs can each see
// a migration as pending and race its DDL (CREATE TYPE has no IF NOT EXISTS, so
// the loser fails on pg_type's unique index). Goose runs SQL migrations on the
// locked connection, so single-connection pools remain supported.
func MigrateInto(ctx context.Context, db *sql.DB, schema string) (err error) {
	if err := pgschema.Validate(schema); err != nil {
		return err
	}
	locker := migrationSessionLocker{}
	if err := bootstrap(ctx, db, locker, schema); err != nil {
		return err
	}

	sqlFS, err := fs.Sub(sqlFiles, "sql")
	if err != nil {
		return err
	}
	var fsys fs.FS = sqlFS
	if schema != pgschema.Default {
		fsys = rewriteFS{fsys: sqlFS, schema: schema}
	}
	p, err := goose.NewProvider(goose.DialectPostgres, db, fsys,
		goose.WithTableName(schema+".goose_db_version"),
		goose.WithSessionLocker(locker),
	)
	if err != nil {
		return err
	}
	_, err = p.Up(ctx)
	return err
}

// bootstrap creates the schema, and outside the default schema the shared
// extensions, under the same advisory lock goose uses. It releases the
// connection before goose acquires its migration connection, which lets a
// pool limited to one open connection make progress.
func bootstrap(ctx context.Context, db *sql.DB, locker migrationSessionLocker, schema string) (err error) {
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, conn.Close()) }()

	if err := locker.SessionLock(ctx, conn); err != nil {
		return err
	}
	defer func() {
		err = errors.Join(err, locker.SessionUnlock(context.WithoutCancel(ctx), conn))
	}()

	if _, err := conn.ExecContext(ctx, "CREATE SCHEMA IF NOT EXISTS "+schema); err != nil {
		return err
	}
	if schema == pgschema.Default {
		return nil
	}
	for _, extension := range extensions {
		if _, err := conn.ExecContext(ctx, "CREATE EXTENSION IF NOT EXISTS "+extension+" SCHEMA public"); err != nil {
			return fmt.Errorf("install extension %s: %w", extension, err)
		}
	}
	return nil
}

// migrationSessionLocker lets goose hold the advisory lock on the same
// *sql.Conn it uses for version checks and SQL migrations.
type migrationSessionLocker struct{}

func (migrationSessionLocker) SessionLock(ctx context.Context, conn *sql.Conn) error {
	if _, err := conn.ExecContext(ctx, "SELECT pg_advisory_lock($1)", migrationLockID); err != nil {
		return fmt.Errorf("acquire migration advisory lock: %w", err)
	}
	return nil
}

func (migrationSessionLocker) SessionUnlock(ctx context.Context, conn *sql.Conn) error {
	var unlocked bool
	if err := conn.QueryRowContext(ctx, "SELECT pg_advisory_unlock($1)", migrationLockID).Scan(&unlocked); err != nil {
		return fmt.Errorf("release migration advisory lock: %w", err)
	}
	if !unlocked {
		return errors.New("release migration advisory lock: lock was not held by this session")
	}
	return nil
}

// rewriteFS serves the embedded migrations with their schema redirected, so
// goose applies the same files into a non-default schema.
type rewriteFS struct {
	fsys   fs.FS
	schema string
}

func (r rewriteFS) Open(name string) (fs.File, error) {
	f, err := r.fsys.Open(name)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil {
		return nil, errors.Join(err, f.Close())
	}
	if info.IsDir() {
		return f, nil
	}
	data, err := io.ReadAll(f)
	if err := errors.Join(err, f.Close()); err != nil {
		return nil, err
	}
	data = []byte(pgschema.Rewrite(string(data), r.schema))
	return &rewrittenFile{
		Reader: bytes.NewReader(data),
		info:   rewrittenInfo{FileInfo: info, size: int64(len(data))},
	}, nil
}

func (r rewriteFS) ReadDir(name string) ([]fs.DirEntry, error) {
	return fs.ReadDir(r.fsys, name)
}

func (r rewriteFS) ReadFile(name string) ([]byte, error) {
	data, err := fs.ReadFile(r.fsys, name)
	if err != nil {
		return nil, err
	}
	return []byte(pgschema.Rewrite(string(data), r.schema)), nil
}

type rewrittenFile struct {
	*bytes.Reader
	info fs.FileInfo
}

func (f *rewrittenFile) Stat() (fs.FileInfo, error) { return f.info, nil }

func (f *rewrittenFile) Close() error { return nil }

type rewrittenInfo struct {
	fs.FileInfo
	size int64
}

func (i rewrittenInfo) Size() int64 { return i.size }

var (
	_ fs.ReadDirFS  = rewriteFS{}
	_ fs.ReadFileFS = rewriteFS{}
	_ fs.File       = (*rewrittenFile)(nil)
)
