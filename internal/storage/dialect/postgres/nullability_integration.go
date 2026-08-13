//go:build postgres_integration

package postgres

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
	return cols
}

// LiveColumnNullability reads column nullability per table from the live
// database schema.
func LiveColumnNullability(ctx context.Context, pool database.Pool) (map[string]map[string]bool, error) {
	p, ok := pool.(*Pool)
	if !ok {
		return nil, fmt.Errorf("postgres.LiveColumnNullability: expected *Pool, got %T", pool)
	}
	rows, err := p.pool.Query(ctx,
		`SELECT table_name, column_name, is_nullable = 'YES' FROM information_schema.columns WHERE table_schema = 'zitadel_nextgen'`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	live := map[string]map[string]bool{}
	for rows.Next() {
		var table, column string
		var nullable bool
		if err := rows.Scan(&table, &column, &nullable); err != nil {
			return nil, err
		}
		if live[table] == nil {
			live[table] = map[string]bool{}
		}
		live[table][column] = nullable
	}
	return live, rows.Err()
}
