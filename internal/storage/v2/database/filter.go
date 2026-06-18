package database

import "slices"

type Filter interface {
	isFilter()
	// TODO replace below with Restricts(column Column) bool
	Restricts(column Column) bool
}

type Column uint8

type AndFilter struct {
	Filters []Filter
}

func And(filters ...Filter) AndFilter {
	return AndFilter{Filters: filters}
}

// Restricts implements [Filter].
func (f AndFilter) Restricts(column Column) bool {
	return slices.ContainsFunc(f.Filters, func(f Filter) bool { return f.Restricts(column) })
}

func (f AndFilter) isFilter() {}

var _ Filter = (*AndFilter)(nil)

type OrFilter struct {
	Filters []Filter
}

func Or(filters ...Filter) OrFilter {
	return OrFilter{Filters: filters}
}

func (f OrFilter) Restricts(column Column) bool {
	if len(f.Filters) == 0 {
		return false
	}
	for _, child := range f.Filters {
		if !child.Restricts(column) {
			return false
		}
	}
	return true
}

func (f OrFilter) isFilter() {}

var _ Filter = (*OrFilter)(nil)

type EqualsFilter struct {
	Columns []Column
	Values  []any
}

func Equal(column Column, value any) *EqualsFilter {
	return Equals([]Column{column}, []any{value})
}

func Equals(columns []Column, values []any) *EqualsFilter {
	return &EqualsFilter{
		Columns: columns,
		Values:  values,
	}
}

// Restricts implements [Filter].
func (e *EqualsFilter) Restricts(column Column) bool {
	return slices.Contains(e.Columns, column)
}

// isFilter implements [Filter].
func (e *EqualsFilter) isFilter() {}

var _ Filter = (*EqualsFilter)(nil)

type GreaterThanFilter struct {
	Columns []Column
	Values  []any
}

func GreaterThan(column Column, value any) *GreaterThanFilter {
	return GreaterThans([]Column{column}, []any{value})
}

func GreaterThans(columns []Column, values []any) *GreaterThanFilter {
	return &GreaterThanFilter{
		Columns: columns,
		Values:  values,
	}
}

// Restricts implements [Filter].
func (g *GreaterThanFilter) Restricts(column Column) bool {
	return slices.Contains(g.Columns, column)
}

// isFilter implements [Filter].
func (g *GreaterThanFilter) isFilter() {}

var _ Filter = (*GreaterThanFilter)(nil)

type LessThanFilter struct {
	Columns []Column
	Values  []any
}

func LessThan(column Column, value any) *LessThanFilter {
	return LessThans([]Column{column}, []any{value})
}

func LessThans(columns []Column, values []any) *LessThanFilter {
	return &LessThanFilter{
		Columns: columns,
		Values:  values,
	}
}

// Restricts implements [Filter].
func (l *LessThanFilter) Restricts(column Column) bool {
	return slices.Contains(l.Columns, column)
}

// isFilter implements [Filter].
func (l *LessThanFilter) isFilter() {}

var _ Filter = (*LessThanFilter)(nil)

// type textCondition[C Column, T ~string] struct {
// 	column   C
// 	operator textOperator
// 	value    T
// }

// type textOperator uint8

// const (
// 	textEqual textOperator = iota
// 	textIgnoreCaseEqual
// )

// func TextEquals[C Column, T ~string](column C, value T) textCondition[C, T] {
// 	return textCondition[C, T]{column: column, operator: textEqual, value: value}
// }

// func TextIgnoreCaseEquals[C Column, T ~string](column C, value T) textCondition[C, T] {
// 	return textCondition[C, T]{column: column, operator: textIgnoreCaseEqual, value: value}
// }

// func (c textCondition[C, T]) isFilter() {}
