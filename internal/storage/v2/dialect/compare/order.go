package compare

import (
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// WriteNullsOrder states the NULL position [CompileNullAware] assumes:
// ASC NULLS FIRST / DESC NULLS LAST. Emitted only for nullable columns,
// because on a NOT NULL column the clause changes nothing semantically but
// stops postgres from matching the default index order (index scan degrades
// to a full sort). Spanner rejects the clause and guarantees this ordering
// by default, so its compiler must not call this.
func WriteNullsOrder[F ~uint8, T any](w Writer, column database.Column[F], direction database.OrderDirection, schema database.Schema[F, T]) {
	if !schema.Nullable(column) {
		return
	}
	if direction == database.OrderDesc {
		w.WriteString(" NULLS LAST")
		return
	}
	w.WriteString(" NULLS FIRST")
}