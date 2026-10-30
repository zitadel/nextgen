//go:build spanner_integration

package migration

import (
	"database/sql"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/storage/migrationtest"
	"github.com/zitadel/nextgen/internal/storage/testdb"
)

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
	ctx := t.Context()

	dsn, stop, err := testdb.SpannerDSN(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	// The "spanner" driver is registered by driver.go under this build tag.
	db, err := sql.Open("spanner", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	p, err := newProvider(db)
	require.NoError(t, err)

	migrationtest.RoundTrip(t, p, func(t *testing.T) migrationtest.Schema {
		return snapshot(t, db)
	}, known)
}

// known: Spanner adds a NOT NULL column to an existing table only with a
// default, and the column 000004 created had none. 000011's Down re-adds
// users.team_id nullable instead of leaving a default behind.
var known = migrationtest.Known{
	11: {"column users.team_id"},
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
