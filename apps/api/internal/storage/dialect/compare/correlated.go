package compare

import (
	"fmt"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// CompileCorrelated compiles a [database.CorrelatedFilter] by writing the
// column's computed expression around the bound values: SQLName, the values
// joined by SQLBetween, then SQLSuffix. Every dialect emits the same shape, so
// the only per-dialect difference is the schema binding's text and the
// placeholder writeValue emits.
func CompileCorrelated[F ~uint8, T any](
	w Writer,
	filter *database.CorrelatedFilter[F],
	schema database.Schema[F, T],
	writeValue func(Writer, any, database.Column[F]),
) {
	between := schema.SQLBetween(filter.Column)
	if len(filter.Values) != len(between)+1 {
		panic(fmt.Sprintf("database: correlated filter takes %d values, got %d", len(between)+1, len(filter.Values)))
	}
	w.WriteString(schema.SQLName(filter.Column))
	for i, value := range filter.Values {
		if i > 0 {
			w.WriteString(between[i-1])
		}
		writeValue(w, value, filter.Column)
	}
	w.WriteString(schema.SQLSuffix(filter.Column))
}
