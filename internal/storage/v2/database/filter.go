package database

import "slices"

type Filter[F ~uint8] interface {
	isFilter()
	Restricts(column Column[F]) bool
}

type AndFilter[F ~uint8] struct {
	Filters []Filter[F]
}

func And[F ~uint8](filters ...Filter[F]) AndFilter[F] {
	combined := make([]Filter[F], 0, len(filters))
	for _, filter := range filters {
		if filter != nil {
			combined = append(combined, filter)
		}
	}
	return AndFilter[F]{Filters: combined}
}

// Restricts implements [Filter].
func (f AndFilter[F]) Restricts(column Column[F]) bool {
	return slices.ContainsFunc(f.Filters, func(filter Filter[F]) bool { return filter.Restricts(column) })
}

func (f AndFilter[F]) isFilter() {}

var _ Filter[uint8] = AndFilter[uint8]{}

type OrFilter[F ~uint8] struct {
	Filters []Filter[F]
}

func Or[F ~uint8](filters ...Filter[F]) OrFilter[F] {
	return OrFilter[F]{Filters: filters}
}

func (f OrFilter[F]) Restricts(column Column[F]) bool {
	return slices.ContainsFunc(f.Filters, func(filter Filter[F]) bool { return filter.Restricts(column) })
}

func (f OrFilter[F]) isFilter() {}

var _ Filter[uint8] = OrFilter[uint8]{}

type EqualsFilter[F ~uint8] struct {
	Columns []Column[F]
	Values  []any
}

// Equal creates a new EqualsFilter for a single column and value.
// The condition will look like "column = value".
func Equal[F ~uint8](column Column[F], value any) *EqualsFilter[F] {
	return Equals([]Column[F]{column}, []any{value})
}

// Equals creates a new EqualsFilter for multiple columns and values.
// The condition will look like "(column1, column2, ...) = (value1, value2, ...)".
func Equals[F ~uint8](columns []Column[F], values []any) *EqualsFilter[F] {
	return &EqualsFilter[F]{
		Columns: columns,
		Values:  values,
	}
}

// Restricts implements [Filter].
func (e *EqualsFilter[F]) Restricts(column Column[F]) bool {
	return slices.Contains(e.Columns, column)
}

// isFilter implements [Filter].
func (e *EqualsFilter[F]) isFilter() {}

var _ Filter[uint8] = (*EqualsFilter[uint8])(nil)

type GreaterThanFilter[F ~uint8] struct {
	Columns []Column[F]
	Values  []any
}

// GreaterThan creates a new GreaterThanFilter for a single column and value.
// The condition will look like "column > value".
func GreaterThan[F ~uint8](column Column[F], value any) *GreaterThanFilter[F] {
	return GreaterThans([]Column[F]{column}, []any{value})
}

// GreaterThans creates a new GreaterThanFilter for multiple columns and values.
// The condition will look like "(column1, column2, ...) > (value1, value2, ...)".
func GreaterThans[F ~uint8](columns []Column[F], values []any) *GreaterThanFilter[F] {
	return &GreaterThanFilter[F]{
		Columns: columns,
		Values:  values,
	}
}

// Restricts implements [Filter].
func (g *GreaterThanFilter[F]) Restricts(column Column[F]) bool {
	return slices.Contains(g.Columns, column)
}

// isFilter implements [Filter].
func (g *GreaterThanFilter[F]) isFilter() {}

var _ Filter[uint8] = (*GreaterThanFilter[uint8])(nil)

type LessThanFilter[F ~uint8] struct {
	Columns []Column[F]
	Values  []any
}

// LessThan creates a new LessThanFilter for a single column and value.
// The condition will look like "column < value".
func LessThan[F ~uint8](column Column[F], value any) *LessThanFilter[F] {
	return LessThans([]Column[F]{column}, []any{value})
}

// LessThans creates a new LessThanFilter for multiple columns and values.
// The condition will look like "(column1, column2, ...) < (value1, value2, ...)".
func LessThans[F ~uint8](columns []Column[F], values []any) *LessThanFilter[F] {
	return &LessThanFilter[F]{
		Columns: columns,
		Values:  values,
	}
}

// Restricts implements [Filter].
func (l *LessThanFilter[F]) Restricts(column Column[F]) bool {
	return slices.Contains(l.Columns, column)
}

// isFilter implements [Filter].
func (l *LessThanFilter[F]) isFilter() {}

var _ Filter[uint8] = (*LessThanFilter[uint8])(nil)
