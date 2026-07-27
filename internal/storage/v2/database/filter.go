package database

import "slices"

type Filter[F ~uint8] interface {
	isFilter()
	Restricts(column Column[F]) bool
}

// EqualStringValue returns the string bound by an Equal filter on field,
// searching nested And filters. Used when a dialect needs a concrete column
// value that is not expressible as a portable Filter fragment (e.g. EAV CTEs).
func EqualStringValue[F ~uint8](filter Filter[F], field F) (string, bool) {
	if filter == nil {
		return "", false
	}
	switch f := filter.(type) {
	case AndFilter[F]:
		for _, sub := range f.Filters {
			if v, ok := EqualStringValue(sub, field); ok {
				return v, true
			}
		}
	case *CompareFilter[F]:
		if f.Op != OpEqual || len(f.Terms) != 1 {
			return "", false
		}
		if f.Terms[0].Column.Field() != field {
			return "", false
		}
		s, ok := f.Terms[0].Value.(string)
		return s, ok
	}
	return "", false
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

type CompareOp uint8

const (
	OpEqual CompareOp = iota
	OpGreater
	OpLess
)

type CompareTerm[F ~uint8] struct {
	Column Column[F]
	Value  any
}

// Term pairs a column with a comparison value.
func Term[F ~uint8](column Column[F], value any) CompareTerm[F] {
	return CompareTerm[F]{Column: column, Value: value}
}

type CompareFilter[F ~uint8] struct {
	Op    CompareOp
	Terms []CompareTerm[F]
}

// Compare builds a comparison filter across one or more column/value terms.
//
// With a single term, Compare compiles to a simple column comparison
// (for example, "created_at > $1"). With multiple terms, Compare compiles to
// lexicographic tuple comparison (for example, "(created_at, id) > ($1, $2)").
// Term order must match the corresponding OrderBy.Columns when used for keyset pagination.
func Compare[F ~uint8](op CompareOp, terms ...CompareTerm[F]) *CompareFilter[F] {
	return &CompareFilter[F]{
		Op:    op,
		Terms: terms,
	}
}

// Equal creates a single-column equality filter: "column = value".
func Equal[F ~uint8](column Column[F], value any) *CompareFilter[F] {
	return Compare(OpEqual, Term(column, value))
}

// GreaterThan creates a single-column greater-than filter: "column > value".
func GreaterThan[F ~uint8](column Column[F], value any) *CompareFilter[F] {
	return Compare(OpGreater, Term(column, value))
}

// LessThan creates a single-column less-than filter: "column < value".
func LessThan[F ~uint8](column Column[F], value any) *CompareFilter[F] {
	return Compare(OpLess, Term(column, value))
}

// CompareEqual creates a tuple equality filter: "(col1, col2, ...) = (val1, val2, ...)".
// With one term this is equivalent to Equal.
func CompareEqual[F ~uint8](terms ...CompareTerm[F]) *CompareFilter[F] {
	return Compare(OpEqual, terms...)
}

// CompareGreater creates a greater-than filter for keyset pagination.
// Pass one term per OrderBy column; for example, three terms restrict rows after
// the cursor position in (col1, col2, col3) sort order.
func CompareGreater[F ~uint8](terms ...CompareTerm[F]) *CompareFilter[F] {
	return Compare(OpGreater, terms...)
}

// CompareLess creates a less-than filter for keyset pagination.
// Pass one term per OrderBy column; term order must match OrderBy.Columns.
func CompareLess[F ~uint8](terms ...CompareTerm[F]) *CompareFilter[F] {
	return Compare(OpLess, terms...)
}

// Restricts implements [Filter].
func (f *CompareFilter[F]) Restricts(column Column[F]) bool {
	return slices.ContainsFunc(f.Terms, func(term CompareTerm[F]) bool { return term.Column == column })
}

func (f *CompareFilter[F]) isFilter() {}

var _ Filter[uint8] = (*CompareFilter[uint8])(nil)
