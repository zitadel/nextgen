package database

// BoolFilter matches on a column that is already a SQL boolean, without binding
// a value. Comparing such a column to a parameter instead (`col = $1`) hides the
// predicate from the planner: an EXISTS-backed column then compiles to a hashed
// subquery over the whole table rather than a semi-join.
type BoolFilter[F ~uint8] struct {
	Column Column[F]
	Want   bool
}

// IsTrue matches rows where the boolean column holds.
func IsTrue[F ~uint8](col Column[F]) *BoolFilter[F] {
	return &BoolFilter[F]{Column: col, Want: true}
}

// IsFalse matches rows where the boolean column does not hold.
func IsFalse[F ~uint8](col Column[F]) *BoolFilter[F] {
	return &BoolFilter[F]{Column: col, Want: false}
}

// Restricts implements [Filter].
func (f *BoolFilter[F]) Restricts(column Column[F]) bool {
	return f.Column == column
}

func (f *BoolFilter[F]) isFilter() {}

var _ Filter[uint8] = (*BoolFilter[uint8])(nil)
