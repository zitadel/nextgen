package database

// CorrelatedFilter matches rows for which the column's correlated predicate
// holds for Value. Unlike the other filters, the bound value lands *inside*
// the column's SQL: the binding is a [FieldBinding.Computed] expression split
// around it, so dialects compile SQLName, the value, then SQLSuffix.
//
// It exists for predicates that reach another table and take a parameter —
// "this session's user is on team X" — which the fixed value-after-column
// shape of [CompareFilter] and [ArrayContainsFilter] cannot express.
type CorrelatedFilter[F ~uint8] struct {
	Column Column[F]
	Value  any
}

// CorrelatedEqual matches when col's correlated predicate holds for value.
func CorrelatedEqual[F ~uint8](col Column[F], value any) *CorrelatedFilter[F] {
	return &CorrelatedFilter[F]{
		Column: col,
		Value:  value,
	}
}

// Restricts implements [Filter].
func (f *CorrelatedFilter[F]) Restricts(column Column[F]) bool {
	return f.Column == column
}

func (f *CorrelatedFilter[F]) isFilter() {}

var _ Filter[uint8] = (*CorrelatedFilter[uint8])(nil)
