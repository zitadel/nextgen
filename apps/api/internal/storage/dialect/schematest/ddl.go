package schematest

import (
	"fmt"
	"slices"
	"strings"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// ColumnNullability pairs a bound column with the DDL nullability its schema
// declares, for the cross-check against live database schemas in stmttest.
type ColumnNullability struct {
	Table    string
	Column   string
	Nullable bool
}

// Columns lists a single-table schema's bound columns. Alias qualifiers on SQL
// names ("s.user_id") are stripped: a single-table schema's alias always
// resolves to table.
func Columns[F ~uint8, T any](table string, schema database.Schema[F, T]) []ColumnNullability {
	var cols []ColumnNullability
	for name, nullable := range schema.ColumnNullability() {
		if _, column, ok := strings.Cut(name, "."); ok {
			name = column
		}
		cols = append(cols, ColumnNullability{Table: table, Column: name, Nullable: nullable})
	}
	sortColumns(cols)
	return cols
}

// JoinColumns lists a join schema's bound columns, resolving each SQL name's
// alias qualifier to its table.
func JoinColumns[F ~uint8, T any](tableByAlias map[string]string, schema database.Schema[F, T]) ([]ColumnNullability, error) {
	var cols []ColumnNullability
	for name, nullable := range schema.ColumnNullability() {
		alias, column, ok := strings.Cut(name, ".")
		if !ok {
			return nil, fmt.Errorf("schematest: join schema column %q has no alias qualifier", name)
		}
		table, ok := tableByAlias[alias]
		if !ok {
			return nil, fmt.Errorf("schematest: no table for alias %q in %q", alias, name)
		}
		cols = append(cols, ColumnNullability{Table: table, Column: column, Nullable: nullable})
	}
	sortColumns(cols)
	return cols, nil
}

func sortColumns(cols []ColumnNullability) {
	slices.SortFunc(cols, func(a, b ColumnNullability) int {
		if c := strings.Compare(a.Table, b.Table); c != 0 {
			return c
		}
		return strings.Compare(a.Column, b.Column)
	})
}
