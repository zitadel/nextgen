//go:build spanner_integration

package migration

import (
	"database/sql"
	"fmt"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/storage/migrationtest"
	"github.com/zitadel/nextgen/internal/storage/testdb"
)

// roundTripWorkers is how many migrations are round-tripped at once when each
// gets a database of its own, as on Spanner Omni in CI. There a schema change
// to an existing database takes seconds, one that builds an index on an
// existing table minutes, and a migration needs three (Up, Down, Up again).
const roundTripWorkers = 6

// TestMigrationsRoundTrip proves every Down restores the schema its Up
// started from, and that the Up applies again after it; see
// [migrationtest.RoundTrip].
//
// It walks through newProvider rather than Migrate: one process needs no
// migration lease.
func TestMigrationsRoundTrip(t *testing.T) {
	if testdb.SpannerSharesDatabase() {
		t.Skip("the round trip tears the schema down, which the database ZITADEL_TEST_SPANNER_URL shares with other packages cannot afford; set ZITADEL_TEST_SPANNER_INSTANCE or neither")
	}
	if !testdb.SpannerProvisions() {
		// The emulator makes a schema change in milliseconds, one at a time:
		// one database walks every migration.
		dsn, stop, err := testdb.SpannerDSN(t.Context())
		require.NoError(t, err)
		t.Cleanup(stop)
		p, db := openProvider(t, dsn)
		migrationtest.RoundTrip(t, p, func(t *testing.T) migrationtest.Schema { return snapshot(t, db) }, known)
		return
	}

	// Each migration gets a database created at the version before it
	// ([Fresh]), so none waits for the schema changes of the ones before.
	latest, err := FreshLatest()
	require.NoError(t, err)
	versions := latest.versions
	require.NotEmpty(t, versions)

	// What [Fresh] created at each version, and what goose's Up of that
	// version left: they must agree, or the databases the other packages
	// test on ([TestDSN]) are not the ones goose would give them.
	var mu sync.Mutex
	created := map[int64]state{}
	migrated := map[int64]state{}

	// Each worker runs its subtests from a goroutine of its own, not as
	// parallel subtests, which -parallel (GOMAXPROCS, 4 on CI's runner)
	// would cap.
	var next atomic.Int64
	var workers sync.WaitGroup
	for range roundTripWorkers {
		workers.Go(func() {
			for i := int(next.Add(1) - 1); i < len(versions); i = int(next.Add(1) - 1) {
				version, previous := versions[i], int64(0)
				if i > 0 {
					previous = versions[i-1]
				}
				t.Run(fmt.Sprintf("%06d", version), func(t *testing.T) {
					fresh, err := FreshAt(previous)
					require.NoError(t, err)
					dsn, stop, err := fresh.Provision(t.Context())
					require.NoError(t, err)
					t.Cleanup(stop)
					p, db := openProvider(t, dsn)

					before := readState(t, db)
					after := migrationtest.RoundTripNext(t, p,
						func(t *testing.T) migrationtest.Schema { return snapshot(t, db) }, known, before.schema)

					mu.Lock()
					defer mu.Unlock()
					created[previous] = before
					migrated[version] = state{schema: after, rows: rows(t, db)}
				})
			}
		})
	}
	workers.Wait()

	// The newest version has no migration after it to create a database at
	// it, and it is the one the other packages get.
	t.Run("created at the newest version", func(t *testing.T) {
		dsn, stop, err := latest.Provision(t.Context())
		require.NoError(t, err)
		t.Cleanup(stop)
		_, db := openProvider(t, dsn)
		created[versions[len(versions)-1]] = readState(t, db)
	})

	for _, version := range versions {
		fresh, viaGoose := created[version], migrated[version]
		if fresh.schema == nil || viaGoose.schema == nil {
			// Its subtest failed and said why.
			continue
		}
		migrationtest.AssertSame(t, viaGoose.schema, fresh.schema,
			"a database created at version %d must have the schema goose's Up of it leaves", version)
		migrationtest.AssertSame(t, viaGoose.rows, fresh.rows,
			"a database created at version %d must hold the rows goose's Up of it leaves", version)
	}
}

// state is a database's schema and the rows its tables hold.
type state struct{ schema, rows migrationtest.Schema }

func readState(t *testing.T, db *sql.DB) state {
	t.Helper()
	return state{schema: snapshot(t, db), rows: rows(t, db)}
}

// openProvider opens the database and returns a goose provider over it.
func openProvider(t *testing.T, dsn string) (*goose.Provider, *sql.DB) {
	t.Helper()
	// The "spanner" driver is registered by driver.go under this build tag.
	db, err := sql.Open("spanner", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	p, err := newProvider(db)
	require.NoError(t, err)
	return p, db
}

// rows reads every row of every table that has any, leaving out goose's
// table, the migration lease and TIMESTAMP columns, which hold when a row was
// written. Only the rows migrations insert are there to read.
func rows(t *testing.T, db *sql.DB) migrationtest.Schema {
	t.Helper()
	s := migrationtest.Schema{}
	columns := map[string][]string{}
	var tables []string
	for _, r := range migrationtest.Rows(t, db, `
		SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
		WHERE TABLE_SCHEMA = '' AND TABLE_NAME NOT IN ('goose_db_version', '`+lockTable+`')
			AND SPANNER_TYPE != 'TIMESTAMP'
		ORDER BY TABLE_NAME, COLUMN_NAME`) {
		if _, ok := columns[r[0]]; !ok {
			tables = append(tables, r[0])
		}
		columns[r[0]] = append(columns[r[0]], "`"+r[1]+"`")
	}
	for _, table := range tables {
		var lines []string
		for _, r := range migrationtest.Rows(t, db, "SELECT "+strings.Join(columns[table], ", ")+" FROM `"+table+"`") {
			lines = append(lines, strings.Join(r, " | "))
		}
		if len(lines) > 0 {
			slices.Sort(lines)
			s.Add(t, migrationtest.Key("rows", table), strings.Join(lines, "\n"))
		}
	}
	return s
}

// known: Spanner adds a NOT NULL column to an existing table only with a
// default, and the column 000004 created had none. 000011's Down re-adds
// users.team_id nullable instead of leaving a default behind, and 000043's
// Down does the same for user_attributes.team_id.
var known = migrationtest.Known{
	11: {"column users.team_id"},
	43: {"column user_attributes.team_id"},
}

// snapshot reads the schema from INFORMATION_SCHEMA, leaving out goose's table
// and the migration lease. Spanner names some objects itself (the indexes
// backing foreign keys, the checks behind NOT NULL, unnamed foreign keys), so
// those are left out or keyed by what they cover. Column order is not
// compared; a Down that re-adds a dropped column can only append it.
func snapshot(t *testing.T, db *sql.DB) migrationtest.Schema {
	t.Helper()
	s := migrationtest.Schema{}
	const ours = `TABLE_SCHEMA = '' AND TABLE_NAME NOT IN ('goose_db_version', '` + lockTable + `')`

	for _, r := range migrationtest.Rows(t, db, `
		SELECT TABLE_NAME, TABLE_TYPE, IFNULL(PARENT_TABLE_NAME, ''), IFNULL(ON_DELETE_ACTION, '')
		FROM INFORMATION_SCHEMA.TABLES WHERE `+ours) {
		s.Add(t, migrationtest.Key("table", r[0]), r[1]+" parent="+r[2]+" on_delete="+r[3])
	}
	for _, r := range migrationtest.Rows(t, db, `
		SELECT TABLE_NAME, COLUMN_NAME, SPANNER_TYPE, IS_NULLABLE,
			IFNULL(COLUMN_DEFAULT, ''), IFNULL(GENERATION_EXPRESSION, ''), IFNULL(IS_STORED, '')
		FROM INFORMATION_SCHEMA.COLUMNS WHERE `+ours) {
		s.Add(t, migrationtest.Key("column", r[0], r[1]),
			r[2]+" nullable="+r[3]+" default="+r[4]+" generated="+r[5]+" stored="+r[6])
	}

	// Index columns in key order, then STORING columns, which have no
	// ordinal position.
	indexColumns := map[string][]string{}
	for _, r := range migrationtest.Rows(t, db, `
		SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, IFNULL(COLUMN_ORDERING, 'STORING')
		FROM INFORMATION_SCHEMA.INDEX_COLUMNS WHERE `+ours+`
		ORDER BY TABLE_NAME, INDEX_NAME, ORDINAL_POSITION IS NULL, ORDINAL_POSITION, COLUMN_NAME`) {
		key := r[0] + "." + r[1]
		indexColumns[key] = append(indexColumns[key], r[2]+" "+r[3])
	}
	for _, r := range migrationtest.Rows(t, db, `
		SELECT TABLE_NAME, INDEX_NAME, INDEX_TYPE, IS_UNIQUE, IS_NULL_FILTERED, IFNULL(PARENT_TABLE_NAME, '')
		FROM INFORMATION_SCHEMA.INDEXES WHERE `+ours+` AND NOT SPANNER_IS_MANAGED`) {
		s.Add(t, migrationtest.Key("index", r[0], r[1]),
			r[2]+" unique="+r[3]+" null_filtered="+r[4]+" interleave="+r[5]+
				" ("+strings.Join(indexColumns[r[0]+"."+r[1]], ", ")+")")
	}

	for _, r := range migrationtest.Rows(t, db, `
		SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
		FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
		JOIN INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
			ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
		WHERE tc.TABLE_SCHEMA = '' AND tc.CONSTRAINT_TYPE = 'CHECK'
			AND NOT STARTS_WITH(tc.CONSTRAINT_NAME, 'CK_IS_NOT_NULL_')`) {
		s.Add(t, migrationtest.Key("check", r[0], r[1]), r[2])
	}

	keyColumns := map[string][]string{}
	for _, r := range migrationtest.Rows(t, db, `
		SELECT CONSTRAINT_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
		WHERE CONSTRAINT_SCHEMA = '' ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`) {
		keyColumns[r[0]] = append(keyColumns[r[0]], r[1])
	}
	for _, r := range migrationtest.Rows(t, db, `
		SELECT tc.TABLE_NAME, rc.CONSTRAINT_NAME, ref.TABLE_NAME, rc.UNIQUE_CONSTRAINT_NAME, rc.UPDATE_RULE, rc.DELETE_RULE
		FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
		JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
			ON tc.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
		JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS ref
			ON ref.CONSTRAINT_SCHEMA = rc.UNIQUE_CONSTRAINT_SCHEMA AND ref.CONSTRAINT_NAME = rc.UNIQUE_CONSTRAINT_NAME
		WHERE rc.CONSTRAINT_SCHEMA = ''`) {
		s.Add(t, migrationtest.Key("foreign key", r[0], strings.Join(keyColumns[r[1]], ",")),
			"references "+r[2]+" ("+strings.Join(keyColumns[r[3]], ",")+") on_update="+r[4]+" on_delete="+r[5])
	}
	return s
}
