package compare

import (
	"github.com/zitadel/nextgen/internal/storage/database"
)

// CompileCorrelated compiles a [database.CorrelatedFilter] by writing the
// column's computed expression around the bound value: SQLName, the value,
// then SQLSuffix. Every dialect emits the same shape, so the only per-dialect
// difference is the schema binding's text and the placeholder writeValue
// emits.
func CompileCorrelated[F ~uint8, T any](
	w Writer,
	filter *database.CorrelatedFilter[F],
	schema database.Schema[F, T],
	writeValue func(Writer, any, database.Column[F]),
) {
	w.WriteString(schema.SQLName(filter.Column))
	writeValue(w, filter.Value, filter.Column)
	w.WriteString(schema.SQLSuffix(filter.Column))
}
