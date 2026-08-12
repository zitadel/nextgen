package compare

import (
	"github.com/zitadel/nextgen/internal/storage/database"
)

// CompileBoolEqual compiles a single-term equality against a bool constant as
// the bare (negated) expression. Planners convert a bare EXISTS / NOT EXISTS
// into a semi/anti-join but evaluate `EXISTS (...) = $1` per row. Reports
// whether the filter was handled.
func CompileBoolEqual[F ~uint8, T any](w Writer, filter *database.CompareFilter[F], schema database.Schema[F, T]) bool {
	if filter.Op != database.OpEqual || len(filter.Terms) != 1 {
		return false
	}
	value, ok := filter.Terms[0].Value.(bool)
	if !ok {
		return false
	}
	if !value {
		w.WriteString("NOT ")
	}
	w.WriteString(schema.SQLName(filter.Terms[0].Column))
	return true
}
