//go:build spanner_integration

package migration

// A migrated database for a test, without the schema changes.
//
// goose brings an empty database to the newest schema one migration at a
// time, each a schema change to an existing database. On Spanner Omni that
// took 17 minutes for 53 migrations (2026-11) and grows with every
// migration, in each of the lane's packages. A database created with the same
// statements has the schema in seconds.
//
// [Fresh] collects those statements from the migrations themselves: every DDL
// statement of the Ups, and the rows the Ups insert. A statement that rewrites
// rows (UPDATE, DELETE, INSERT ... SELECT) is left out, since a new database
// has none to rewrite.
//
// TestMigrationsRoundTrip holds the two routes together: it applies each
// migration through goose to a database Fresh built for the version before
// it, and compares the schema and the rows with what Fresh builds for that
// version.

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"slices"
	"strconv"
	"strings"

	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/database"

	"github.com/zitadel/nextgen/internal/storage/testdb"
)

// Fresh is what gives a new database the state goose leaves it in after the
// migrations up to a version.
type Fresh struct {
	// Schema is the Ups' DDL, in order: the statements to create the database
	// with ([testdb.SpannerDSNWithSchema]).
	Schema []string
	// rows are the Ups' INSERT ... VALUES statements, in order.
	rows []string
	// versions are the migrations covered.
	versions []int64
}

// FreshAt returns the statements of every migration up to and including
// version; 0 is the empty database.
func FreshAt(version int64) (Fresh, error) {
	sqlFS, err := fs.Sub(sqlFiles, "sql")
	if err != nil {
		return Fresh{}, err
	}
	names, err := fs.Glob(sqlFS, "*.sql")
	if err != nil {
		return Fresh{}, err
	}
	slices.Sort(names)

	var fresh Fresh
	for _, name := range names {
		digits, _, _ := strings.Cut(name, "_")
		v, err := strconv.ParseInt(digits, 10, 64)
		if err != nil {
			return Fresh{}, fmt.Errorf("%s: no version in the file name: %w", name, err)
		}
		if v > version {
			continue
		}
		src, err := fs.ReadFile(sqlFS, name)
		if err != nil {
			return Fresh{}, err
		}
		if err := fresh.addUp(name, string(src)); err != nil {
			return Fresh{}, err
		}
		fresh.versions = append(fresh.versions, v)
	}
	return fresh, nil
}

// FreshLatest is [FreshAt] the newest migration.
func FreshLatest() (Fresh, error) {
	return FreshAt(goose.MaxVersion)
}

// addUp sorts the statements of one migration's Up section.
func (f *Fresh) addUp(name, src string) error {
	inUp, inStatement := false, false
	var block []string
	for _, line := range strings.Split(src, "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case trimmed == gooseUp:
			inUp = true
		case trimmed == gooseDown:
			inUp = false
		case !inUp:
		case trimmed == stmtBegin:
			inStatement, block = true, nil
		case trimmed == stmtEnd:
			inStatement = false
			statement := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(strings.Join(block, "\n")), ";"))
			switch {
			case isDDLStatement(block):
				f.Schema = append(f.Schema, statement)
			case insertsRows(block):
				f.rows = append(f.rows, statement)
			}
		case inStatement:
			block = append(block, line)
		case isSubstantiveSQL(trimmed):
			// batchDDL leaves such a statement unbatched; here it could not
			// be told from DDL at all.
			return fmt.Errorf("%s: a statement outside %s: %s", name, stmtBegin, trimmed)
		}
	}
	return nil
}

// insertsRows reports whether a goose statement block adds rows of its own
// (INSERT ... VALUES) rather than rewriting or copying the ones a table holds.
func insertsRows(block []string) bool {
	var words []string
	for _, line := range block {
		if trimmed := strings.TrimSpace(line); trimmed != "" && !strings.HasPrefix(trimmed, "--") {
			words = append(words, strings.Fields(strings.ToUpper(trimmed))...)
		}
	}
	return len(words) > 0 && words[0] == "INSERT" && !slices.Contains(words, "SELECT")
}

// Finish gives a database created with f.Schema the rest of what goose
// leaves behind: the rows, and its own table with every covered version
// marked as applied.
func (f Fresh) Finish(ctx context.Context, db *sql.DB) error {
	for _, statement := range f.rows {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("insert the migrations' rows: %w", err)
		}
	}
	store, err := database.NewStore(database.DialectSpanner, goose.DefaultTablename)
	if err != nil {
		return err
	}
	if err := store.CreateVersionTable(ctx, db); err != nil {
		return fmt.Errorf("create goose's version table: %w", err)
	}
	// goose itself starts the table with version 0.
	for _, version := range append([]int64{0}, f.versions...) {
		if err := store.Insert(ctx, db, database.InsertRequest{Version: version}); err != nil {
			return fmt.Errorf("mark version %d as applied: %w", version, err)
		}
	}
	return nil
}

// TestDSN returns the DSN of a database for an integration test, as
// [testdb.SpannerDSN] does. Where each call provisions a database
// ([testdb.SpannerProvisions]) it is created at the newest schema, so the
// caller's Migrate finds nothing left to apply.
func TestDSN(ctx context.Context) (string, func(), error) {
	if !testdb.SpannerProvisions() {
		return testdb.SpannerDSN(ctx)
	}
	fresh, err := FreshLatest()
	if err != nil {
		return "", func() {}, err
	}
	return fresh.Provision(ctx)
}

// Provision creates a database in the state f describes and returns its DSN
// and the func that drops it.
func (f Fresh) Provision(ctx context.Context) (string, func(), error) {
	dsn, stop, err := testdb.SpannerDSNWithSchema(ctx, f.Schema)
	if err != nil {
		return "", stop, err
	}
	db, err := sql.Open("spanner", dsn)
	if err != nil {
		stop()
		return "", func() {}, err
	}
	defer func() { _ = db.Close() }()
	if err := f.Finish(ctx, db); err != nil {
		stop()
		return "", func() {}, err
	}
	return dsn, stop, nil
}
