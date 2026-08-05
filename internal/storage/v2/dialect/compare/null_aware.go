// Package compare provides shared SQL fragments for dialect statement compilers.
package compare

import (
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// Writer is the minimal surface for emitting SQL text fragments.
type Writer interface {
	WriteString(string)
}

// HasNilValue reports whether any compare term binds a SQL NULL (Go nil).
func HasNilValue[F ~uint8](terms []database.CompareTerm[F]) bool {
	for _, term := range terms {
		if term.Value == nil {
			return true
		}
	}
	return false
}

// CompileNullAware expands keyset compares when any cursor value is SQL NULL.
// Assumes ASC NULLS FIRST / DESC NULLS LAST (correct for all-NULL leading
// order columns on every dialect; matches SQLite defaults).
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
	case database.OpGreater, database.OpLess:
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
		if op == database.OpGreater {
			w.WriteString(col)
			w.WriteString(" IS NOT NULL")
			return
		}
		w.WriteString("FALSE")
		return
	}
	if op == database.OpLess {
		w.WriteString("(")
		w.WriteString(col)
		w.WriteString(" < ")
		writeValue(w, term.Value, term.Column)
		w.WriteString(" OR ")
		w.WriteString(col)
		w.WriteString(" IS NULL)")
		return
	}
	w.WriteString(col)
	w.WriteString(" > ")
	writeValue(w, term.Value, term.Column)
}
