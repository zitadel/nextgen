package database

// CorrelatedFilter matches rows for which the column's correlated predicate
// holds for Values. Unlike the other filters, the bound values land *inside*
// the column's SQL: the binding is a [FieldBinding.Computed] expression split
// around them, so dialects compile SQLName, the values joined by SQLBetween,
// then SQLSuffix.
//
// It exists for predicates that reach another table and take a parameter —
// "this session's user is owned by team X" — which the fixed value-after-column
// shape of [CompareFilter] and [ArrayContainsFilter] cannot express.
type CorrelatedFilter[F ~uint8] struct {
	Column Column[F]
	Values []any
}

// CorrelatedEqual matches when col's correlated predicate holds for values,
// one per value slot of its binding.
func CorrelatedEqual[F ~uint8](col Column[F], values ...any) *CorrelatedFilter[F] {
	return &CorrelatedFilter[F]{
		Column: col,
		Values: values,
	}
}

// Restricts implements [Filter].
func (f *CorrelatedFilter[F]) Restricts(column Column[F]) bool {
	return f.Column == column
}

func (f *CorrelatedFilter[F]) isFilter() {}

var _ Filter[uint8] = (*CorrelatedFilter[uint8])(nil)
