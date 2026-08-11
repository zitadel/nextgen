//go:build sqlite_integration

package sqlite

import (
	"context"
	"fmt"

	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/schematest"
)

// SchemaColumnNullability lists the DDL nullability expected for every column
// bound by this dialect's unexported schemas, so stmttest can cross-check the
// Nullable flags against the live database schema.
func SchemaColumnNullability() []schematest.ColumnNullability {
	var cols []schematest.ColumnNullability
	cols = append(cols, schematest.Columns("projects", projectSchema)...)
	cols = append(cols, schematest.Columns("teams", teamSchema)...)
	cols = append(cols, schematest.Columns("tokens", tokenSchema)...)
	cols = append(cols, schematest.Columns("sessions", sessionSchema)...)
	cols = append(cols, schematest.Columns("encryption_keys", encryptionKeySchema)...)
	cols = append(cols, schematest.Columns("signing_keys", signingKeySchema)...)
	cols = append(cols, schematest.Columns("json_schemas", jsonSchemaSchema)...)
	for i := range cols {
		// sessions.expires_at is generated from NOT NULL operands and never
		// holds NULL, but the DDL omits NOT NULL, so introspection reports it
		// nullable. The binding correctly stays non-nullable.
		if cols[i].Table == "sessions" && cols[i].Column == "expires_at" {
			cols[i].Nullable = true
		}
	}
	return cols
}

// LiveColumnNullability reads column nullability per table from the live
// database schema. pragma_table_xinfo, not pragma_table_info: only the former
// lists generated columns.
func LiveColumnNullability(ctx context.Context, pool database.Pool) (map[string]map[string]bool, error) {
	p, ok := pool.(*Pool)
	if !ok {
		return nil, fmt.Errorf("sqlite.LiveColumnNullability: expected *Pool, got %T", pool)
	}
	rows, err := p.sqlDB.QueryContext(ctx,
		`SELECT m.name, ti.name, ti."notnull" FROM sqlite_master m JOIN pragma_table_xinfo(m.name) ti WHERE m.type = 'table'`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	live := map[string]map[string]bool{}
	for rows.Next() {
		var table, column string
		var notNull int
		if err := rows.Scan(&table, &column, &notNull); err != nil {
			return nil, err
		}
		if live[table] == nil {
			live[table] = map[string]bool{}
		}
		live[table][column] = notNull == 0
	}
	return live, rows.Err()
}