//go:build spanner_integration

package spanner

import (
	"context"
	"fmt"
	"slices"

	"cloud.google.com/go/spanner"

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
	// Introspection always reports the generated sessions.expires_at as
	// nullable, so the flag is only checkable on postgres, where it is a
	// plain column.
	return slices.DeleteFunc(cols, func(c schematest.ColumnNullability) bool {
		return c.Table == "sessions" && c.Column == "expires_at"
	})
}

// LiveColumnNullability reads column nullability per table from the live
// database schema.
func LiveColumnNullability(ctx context.Context, pool database.Pool) (map[string]map[string]bool, error) {
	c, ok := pool.(*Client)
	if !ok {
		return nil, fmt.Errorf("spanner.LiveColumnNullability: expected *Client, got %T", pool)
	}
	db := newClientDB(c.client)
	live := map[string]map[string]bool{}
	err := db.Query(ctx, buildStatement(
		`SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = ''`,
	).statement(), func(iter *spanner.RowIterator) error {
		return iter.Do(func(row *spanner.Row) error {
			var table, column, isNullable string
			if err := row.Columns(&table, &column, &isNullable); err != nil {
				return err
			}
			if live[table] == nil {
				live[table] = map[string]bool{}
			}
			live[table][column] = isNullable == "YES"
			return nil
		})
	})
	if err != nil {
		return nil, err
	}
	return live, nil
}
