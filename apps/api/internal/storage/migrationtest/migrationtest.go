// Package migrationtest walks a dialect's goose migrations one step at a time
// and proves each Down puts the schema back the way its Up found it.
//
// It imports no dialect: each dialect's test supplies the provider and a
// snapshot of its own catalog.
package migrationtest

import (
	"database/sql"
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Schema maps a schema object key, such as "column users.team_id", to its
// definition. Two snapshots are equal when the same objects have the same
// definitions.
type Schema map[string]string

// Known lists, per migration version, the Schema keys that version's Down
// cannot restore exactly. Keep a comment with each entry saying why the
// engine leaves no better option; a Down that merely forgets something gets
// fixed, not listed.
type Known map[int64][]string

// RoundTrip applies p's migrations one at a time. For each one it applies the
// Up, rolls it back, checks the schema equals the one before the Up, applies
// the Up again and checks the schema equals the one after the first Up.
//
// Each Down therefore runs on the same schema a full rollback from the latest
// version would give it, and a difference listed in known stays confined to
// its own step instead of spreading into every comparison below it.
//
// The database must have no migrations applied. snapshot must leave out
// goose's own bookkeeping table.
func RoundTrip(t *testing.T, p *goose.Provider, snapshot func(t *testing.T) Schema, known Known) {
	t.Helper()
	sources := p.ListSources()
	require.NotEmpty(t, sources, "the provider has no migrations to walk")
	RoundTripRange(t, p, snapshot, known, sources[0].Version, sources[len(sources)-1].Version)
}

// RoundTripRange walks the migrations from version first to version last, both
// included, as RoundTrip walks them all, after applying the ones before first
// unchecked. A dialect whose schema changes are slow splits the walk into
// ranges, each in a database of its own, and walks them at once.
func RoundTripRange(t *testing.T, p *goose.Provider, snapshot func(t *testing.T) Schema, known Known, first, last int64) {
	t.Helper()
	ctx := t.Context()

	sources := p.ListSources()
	current, err := p.GetDBVersion(ctx)
	require.NoError(t, err)
	require.Zero(t, current, "the round trip needs a database with no migrations applied")

	for v := range known {
		require.True(t, slices.ContainsFunc(sources, func(s *goose.Source) bool { return s.Version == v }),
			"known lists version %d, which has no migration", v)
	}

	start := slices.IndexFunc(sources, func(s *goose.Source) bool { return s.Version >= first })
	end := slices.IndexFunc(sources, func(s *goose.Source) bool { return s.Version > last })
	if end < 0 {
		end = len(sources)
	}
	require.True(t, start >= 0 && start < end, "no migration from version %d to %d", first, last)
	if start > 0 {
		_, err := p.UpTo(ctx, sources[start-1].Version)
		require.NoError(t, err, "Up to %s", sources[start-1].Path)
	}

	before := snapshot(t)
	for _, source := range sources[start:end] {
		name := source.Path
		began := time.Now()

		_, err := p.UpByOne(ctx)
		require.NoError(t, err, "Up of %s", name)
		after := snapshot(t)

		_, err = p.Down(ctx)
		require.NoError(t, err, "Down of %s", name)
		rolledBack := snapshot(t)
		compareRolledBack(t, name, before, rolledBack, known[source.Version])

		_, err = p.UpByOne(ctx)
		require.NoError(t, err, "Up of %s again, after its Down", name)
		assertSame(t, after, snapshot(t), "Up of %s again, after its Down, must give the schema its first Up gave", name)

		// A walk that outlasts its timeout shows how far it got and where the
		// time went.
		t.Logf("%s: Up, Down and Up again in %s", name, time.Since(began).Round(time.Millisecond))
		before = after
	}

	version, err := p.GetDBVersion(ctx)
	require.NoError(t, err)
	require.Equal(t, sources[end-1].Version, version, "the walk must end at the last migration of its range")
}

// compareRolledBack asserts want and got are equal apart from the keys in
// allowed, and that every allowed key still differs, so an entry in Known
// goes once the Down learns to restore it.
func compareRolledBack(t *testing.T, name string, want, got Schema, allowed []string) {
	t.Helper()
	want, got = maps.Clone(want), maps.Clone(got)
	for _, key := range allowed {
		w, inWant := want[key]
		g, inGot := got[key]
		assert.False(t, inWant == inGot && w == g,
			"Down of %s now restores %q; remove it from the known differences", name, key)
		delete(want, key)
		delete(got, key)
	}
	assertSame(t, want, got, "Down of %s must restore the schema its Up started from", name)
}

// assertSame reports only the objects that differ: a whole schema in the
// failure message would bury them.
func assertSame(t *testing.T, want, got Schema, msg string, args ...any) {
	t.Helper()
	var diff []string
	for _, key := range slices.Sorted(maps.Keys(want)) {
		if g, ok := got[key]; !ok {
			diff = append(diff, "- "+key+": "+want[key])
		} else if g != want[key] {
			diff = append(diff, "- "+key+": "+want[key], "+ "+key+": "+g)
		}
	}
	for _, key := range slices.Sorted(maps.Keys(got)) {
		if _, ok := want[key]; !ok {
			diff = append(diff, "+ "+key+": "+got[key])
		}
	}
	if len(diff) > 0 {
		assert.Fail(t, fmt.Sprintf(msg, args...), "- want, + got:\n%s", strings.Join(diff, "\n"))
	}
}

// Key builds a Schema key from an object kind and its name parts, for example
// Key("column", "users", "team_id") is "column users.team_id".
func Key(kind string, name ...string) string {
	return kind + " " + strings.Join(name, ".")
}

// Add records def under key, failing the test if a snapshot query returns
// one object twice: silently keeping either definition would hide a change.
func (s Schema) Add(t *testing.T, key, def string) {
	t.Helper()
	if prev, ok := s[key]; ok {
		require.Failf(t, "duplicate schema key", "%s: %q and %q", key, prev, def)
	}
	s[key] = def
}

// Rows runs a catalog query and returns every row with each value rendered as
// text, NULL as "NULL". It reads all rows before returning, so the caller may
// query again per row on a pool limited to one connection.
func Rows(t *testing.T, db *sql.DB, query string, args ...any) [][]string {
	t.Helper()
	rows, err := db.QueryContext(t.Context(), query, args...)
	require.NoError(t, err, query)
	defer func() { _ = rows.Close() }()
	cols, err := rows.Columns()
	require.NoError(t, err)

	var out [][]string
	for rows.Next() {
		values := make([]any, len(cols))
		dest := make([]any, len(cols))
		for i := range values {
			dest[i] = &values[i]
		}
		require.NoError(t, rows.Scan(dest...), query)
		row := make([]string, len(cols))
		for i, v := range values {
			switch v := v.(type) {
			case nil:
				row[i] = "NULL"
			case []byte:
				row[i] = string(v)
			default:
				row[i] = fmt.Sprint(v)
			}
		}
		out = append(out, row)
	}
	require.NoError(t, rows.Err(), query)
	return out
}
