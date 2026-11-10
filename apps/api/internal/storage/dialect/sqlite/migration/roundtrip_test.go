package migration

import (
	"database/sql"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	_ "modernc.org/sqlite" // registers the "sqlite" database/sql driver the dialect migrates through

	"github.com/zitadel/nextgen/internal/storage/migrationtest"
)

// TestMigrationsRoundTrip proves every Down restores the schema its Up
// started from, and that the Up applies again after it; see
// [migrationtest.RoundTrip].
//
// No build tag: SQLite needs no container, so the walk is as cheap as any
// unit test and runs with them.
func TestMigrationsRoundTrip(t *testing.T) {
	// Opened as the dialect opens it: the same pragmas, foreign keys on
	// among them, and one connection.
	dsn := &url.URL{
		Scheme:   "file",
		Path:     filepath.ToSlash(filepath.Join(t.TempDir(), "roundtrip.db")),
		RawQuery: PragmaQuery,
	}
	db, err := sql.Open("sqlite", dsn.String())
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	p, err := newProvider(db)
	require.NoError(t, err)

	migrationtest.RoundTrip(t, p, func(t *testing.T) migrationtest.Schema {
		return snapshot(t, db)
	}, known)
}

// known: SQLite's ALTER TABLE ADD COLUMN takes NOT NULL only with a non-NULL
// default, so a Down that re-adds a NOT NULL column the Up dropped leaves that
// default behind. The only way around it is rebuilding the table, which drops
// it: for projects that cascades into every child table, and for
// user_passwords it is a lot of Down for a default nothing relies on.
var known = migrationtest.Known{
	13: {"column user_passwords.changed_at"},
	14: {"column user_passwords.updated_at"},
	19: {"column projects.preview_origins"},
}

// snapshot reads the schema from the catalog pragmas rather than from the
// CREATE TABLE text sqlite_schema keeps: a table rebuilt by a migration stores
// different text for the same shape. The cost is that CHECK constraints,
// which only that text holds, are not compared. Column order is not compared
// either; a Down that re-adds a dropped column can only append it.
func snapshot(t *testing.T, db *sql.DB) migrationtest.Schema {
	t.Helper()
	s := migrationtest.Schema{}

	var tables []string
	for _, row := range migrationtest.Rows(t, db,
		`SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'goose_db_version'`) {
		tables = append(tables, row[0])
	}
	for _, table := range tables {
		s.Add(t, migrationtest.Key("table", table), "")
		for _, c := range migrationtest.Rows(t, db,
			`SELECT name, type, "notnull", dflt_value, pk, hidden FROM pragma_table_xinfo(?)`, table) {
			s.Add(t, migrationtest.Key("column", table, c[0]),
				"type="+c[1]+" notnull="+c[2]+" default="+c[3]+" pk="+c[4]+" hidden="+c[5])
		}

		// One row per column pair; id groups the pairs of a composite key.
		type foreignKey struct {
			from, to []string
			def      string
		}
		var fks []*foreignKey
		byID := map[string]*foreignKey{}
		for _, r := range migrationtest.Rows(t, db,
			`SELECT id, "table", "from", "to", on_update, on_delete, match FROM pragma_foreign_key_list(?) ORDER BY id, seq`, table) {
			fk, ok := byID[r[0]]
			if !ok {
				fk = &foreignKey{def: "references " + r[1] + " on_update=" + r[4] + " on_delete=" + r[5] + " match=" + r[6]}
				byID[r[0]] = fk
				fks = append(fks, fk)
			}
			fk.from = append(fk.from, r[2])
			fk.to = append(fk.to, r[3])
		}
		for _, fk := range fks {
			s.Add(t, migrationtest.Key("foreign key", table, strings.Join(fk.from, ",")),
				fk.def+" ("+strings.Join(fk.to, ",")+")")
		}

		for _, ix := range migrationtest.Rows(t, db,
			`SELECT name, "unique", origin, partial FROM pragma_index_list(?)`, table) {
			var cols []string
			for _, c := range migrationtest.Rows(t, db,
				`SELECT coalesce(name, '<expr>'), "desc", coll FROM pragma_index_xinfo(?) WHERE key = 1 ORDER BY seqno`, ix[0]) {
				cols = append(cols, c[0]+" desc="+c[1]+" coll="+c[2])
			}
			covers := "(" + strings.Join(cols, ", ") + ")"
			def := "unique=" + ix[1] + " partial=" + ix[3]
			if ix[2] == "c" {
				// Named by CREATE INDEX; its text, below, adds a partial
				// index's WHERE.
				s.Add(t, migrationtest.Key("index", ix[0]), table+covers+" "+def)
				continue
			}
			// sqlite_autoindex_<table>_<n> numbers by declaration order, which
			// a rebuilt table can change; key it by what it covers instead.
			s.Add(t, migrationtest.Key("index", table, ix[2]+covers), def)
		}
	}

	for _, row := range migrationtest.Rows(t, db,
		`SELECT type, name, sql FROM sqlite_schema WHERE type IN ('index', 'trigger', 'view') AND sql IS NOT NULL`) {
		s.Add(t, migrationtest.Key(row[0]+" sql", row[1]), strings.Join(strings.Fields(row[2]), " "))
	}
	return s
}
