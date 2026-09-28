package database

// ArrayContainsFilter matches when a SQL array column contains Value.
// Dialects compile this differently (Postgres ANY / Spanner UNNEST).
type ArrayContainsFilter[F ~uint8] struct {
	Column Column[F]
	Value  any
}

// ArrayContains matches when the array column contains value.
func ArrayContains[F ~uint8](col Column[F], value any) *ArrayContainsFilter[F] {
	return &ArrayContainsFilter[F]{
		Column: col,
		Value:  value,
	}
}

// Restricts implements [Filter].
func (f *ArrayContainsFilter[F]) Restricts(column Column[F]) bool {
	return f.Column == column
}

func (f *ArrayContainsFilter[F]) isFilter() {}

var _ Filter[uint8] = (*ArrayContainsFilter[uint8])(nil)
