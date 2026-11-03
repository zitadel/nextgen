// Package compare provides shared SQL fragments for dialect statement compilers.
package compare

import (
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Writer is the minimal surface for emitting SQL text fragments.
type Writer interface {
	WriteString(string)
}

// NeedsNullAware reports whether a compare must use null-safe expansion:
// any term binds SQL NULL, or a keyset compare touches a nullable column
// (a non-nil cursor value must still admit NULL rows beyond the cursor).
func NeedsNullAware[F ~uint8, T any](filter *database.CompareFilter[F], schema database.Schema[F, T]) bool {
	for _, term := range filter.Terms {
		if term.Value == nil {
			return true
		}
		if filter.Keyset && schema.Nullable(term.Column) {
			return true
		}
	}
	return false
}

// CompileNullAware expands compares whose terms bind SQL NULL or cover
// nullable keyset columns. Requires ASC NULLS FIRST / DESC NULLS LAST:
// postgres and sqlite state it explicitly in ORDER BY for nullable columns,
// spanner rejects the clause but guarantees that ordering by default.
// writeValue emits a bound placeholder (and any dialect cast) for non-nil values.
func CompileNullAware[F ~uint8, T any](
	w Writer,
	filter *database.CompareFilter[F],
	schema database.Schema[F, T],
	writeValue func(Writer, any, database.Column[F]),
) {
	switch filter.Op {
	case database.OpEqual:
		w.WriteString("(")
		for i, term := range filter.Terms {
			if i > 0 {
				w.WriteString(" AND ")
			}
			writeNullSafeEqual(w, term, schema, writeValue)
		}
		w.WriteString(")")
	case database.OpGreater, database.OpLess, database.OpGreaterOrEqual:
		w.WriteString("(")
		for i := range filter.Terms {
			if i > 0 {
				w.WriteString(" OR ")
			}
			w.WriteString("(")
			for j := 0; j < i; j++ {
				writeNullSafeEqual(w, filter.Terms[j], schema, writeValue)
				w.WriteString(" AND ")
			}
			writeNullSafeOrdered(w, filter.Terms[i], filter.Op, schema, writeValue)
			w.WriteString(")")
		}
		w.WriteString(")")
	default:
		panic("unknown compare op")
	}
}

func writeNullSafeEqual[F ~uint8, T any](
	w Writer,
	term database.CompareTerm[F],
	schema database.Schema[F, T],
	writeValue func(Writer, any, database.Column[F]),
) {
	col := schema.SQLName(term.Column)
	if term.Value == nil {
		w.WriteString(col)
		w.WriteString(" IS NULL")
		return
	}
	w.WriteString(col)
	w.WriteString(" = ")
	writeValue(w, term.Value, term.Column)
}

func writeNullSafeOrdered[F ~uint8, T any](
	w Writer,
	term database.CompareTerm[F],
	op database.CompareOp,
	schema database.Schema[F, T],
	writeValue func(Writer, any, database.Column[F]),
) {
	col := schema.SQLName(term.Column)
	if term.Value == nil {
		if op == database.OpGreater || op == database.OpGreaterOrEqual {
			w.WriteString(col)
			w.WriteString(" IS NOT NULL")
			return
		}
		w.WriteString("FALSE")
		return
	}
	if op == database.OpLess {
		// Under DESC NULLS LAST the NULL rows sort after any non-nil cursor
		// value, so they must keep being admitted. On a NOT NULL column the
		// IS NULL arm is a no-op.
		w.WriteString("(")
		w.WriteString(col)
		w.WriteString(" < ")
		writeValue(w, term.Value, term.Column)
		w.WriteString(" OR ")
		w.WriteString(col)
		w.WriteString(" IS NULL)")
		return
	}
	if op == database.OpGreaterOrEqual {
		w.WriteString(col)
		w.WriteString(" >= ")
		writeValue(w, term.Value, term.Column)
		return
	}
	w.WriteString(col)
	w.WriteString(" > ")
	writeValue(w, term.Value, term.Column)
}
