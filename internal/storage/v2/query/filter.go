package query

import "fmt"

// Filter is a dialect-neutral predicate AST compiled to SQL per dialect.
type Filter interface {
	isFilter()
	Restricts(column any) bool
}

// Column is a per-entity column enum (uint8-backed).
type Column interface {
	~uint8
}

type AndFilter struct {
	Filters []Filter
}

func And(filters ...Filter) AndFilter {
	return AndFilter{Filters: filters}
}

func (f AndFilter) isFilter() {}

func (f AndFilter) Restricts(column any) bool {
	for _, child := range f.Filters {
		if child.Restricts(column) {
			return true
		}
	}
	return false
}

type OrFilter struct {
	Filters []Filter
}

func Or(filters ...Filter) OrFilter {
	return OrFilter{Filters: filters}
}

func (f OrFilter) isFilter() {}

func (f OrFilter) Restricts(column any) bool {
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

type TextEqualsFilter[C Column] struct {
	Column C
	Value  string
}

func TextEquals[C Column](column C, value string) TextEqualsFilter[C] {
	return TextEqualsFilter[C]{Column: column, Value: value}
}

func (f TextEqualsFilter[C]) isFilter() {}

func (f TextEqualsFilter[C]) Restricts(column any) bool {
	c, ok := column.(C)
	return ok && f.Column == c
}

type EnumEqualsFilter[C Column] struct {
	Column C
	Value  string
}

func EnumEquals[C Column](column C, value string) EnumEqualsFilter[C] {
	return EnumEqualsFilter[C]{Column: column, Value: value}
}

func (f EnumEqualsFilter[C]) isFilter() {}

func (f EnumEqualsFilter[C]) Restricts(column any) bool {
	c, ok := column.(C)
	return ok && f.Column == c
}

// ErrMissingScope is returned when a required scope column is not restricted.
type ErrMissingScope struct {
	Column any
}

func (e ErrMissingScope) Error() string {
	return fmt.Sprintf("filter must restrict column %v", e.Column)
}

// RequireRestricts ensures the filter constrains every required column.
func RequireRestricts(filter Filter, columns ...any) error {
	for _, col := range columns {
		if !filter.Restricts(col) {
			return ErrMissingScope{Column: col}
		}
	}
	return nil
}
