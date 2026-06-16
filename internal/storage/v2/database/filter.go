package database

type Filter interface {
	isFilter()
}

type AndFilter struct {
	Filters []Filter
}

func And(filters ...Filter) AndFilter {
	return AndFilter{Filters: filters}
}

func (f AndFilter) isFilter() {}

type OrFilter struct {
	Filters []Filter
}

func Or(filters ...Filter) OrFilter {
	return OrFilter{Filters: filters}
}

func (f OrFilter) isFilter() {}

type textCondition[C Column, T ~string] struct {
	column   C
	operator textOperator
	value    T
}

type textOperator uint8

const (
	textEqual textOperator = iota
	textIgnoreCaseEqual
)

func TextEquals[C Column, T ~string](column C, value T) textCondition[C, T] {
	return textCondition[C, T]{column: column, operator: textEqual, value: value}
}

func TextIgnoreCaseEquals[C Column, T ~string](column C, value T) textCondition[C, T] {
	return textCondition[C, T]{column: column, operator: textIgnoreCaseEqual, value: value}
}

func (c textCondition[C, T]) isFilter() {}

type Column interface{ ~uint8 }
