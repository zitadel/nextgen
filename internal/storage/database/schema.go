package database

import "fmt"

// FieldBinding maps a domain field to its SQL column name and entity accessor.
type FieldBinding[T any] struct {
	SQLName  string
	Accessor func(*T) any
	Coerce   func(any) (any, error)
	// ParamCast is an optional Postgres type cast appended after bound
	// placeholders for this column (e.g. "::myschema.my_enum"). Empty means
	// no cast. Spanner ignores this field.
	ParamCast string
	// Nullable marks columns that can hold SQL NULL. Keyset compares over
	// nullable columns need null-aware SQL, and ORDER BY states their NULL
	// position explicitly (ASC NULLS FIRST / DESC NULLS LAST on every dialect).
	Nullable bool
}

// NullableValue flattens a nil pointer to untyped nil so it binds as SQL NULL.
// Returning *p directly would box a typed nil that fails == nil checks.
func NullableValue[V any](p *V) any {
	if p == nil {
		return nil
	}
	return *p
}

// Schema resolves domain fields to SQL names and entity values for one entity type.
type Schema[F ~uint8, T any] struct {
	fields map[F]FieldBinding[T]
}

// NewSchema constructs a schema from per-field bindings. Every bindable field for
// list/filter/order operations must be present; unspecified enum values must not.
func NewSchema[F ~uint8, T any](bindings map[F]FieldBinding[T]) Schema[F, T] {
	return Schema[F, T]{fields: bindings}
}

func (s Schema[F, T]) binding(field F) FieldBinding[T] {
	b, ok := s.fields[field]
	if !ok {
		panic(fmt.Sprintf("database: unknown field %v", field))
	}
	return b
}

// SQLName returns the SQL column name for col.
func (s Schema[F, T]) SQLName(col Column[F]) string {
	return s.binding(col.Field()).SQLName
}

// ParamCast returns the optional Postgres parameter cast for col.
func (s Schema[F, T]) ParamCast(col Column[F]) string {
	return s.binding(col.Field()).ParamCast
}

// Nullable reports whether col can hold SQL NULL.
func (s Schema[F, T]) Nullable(col Column[F]) bool {
	return s.binding(col.Field()).Nullable
}

// MustSQLName returns the SQL column name for field.
func (s Schema[F, T]) MustSQLName(field F) string {
	return s.binding(field).SQLName
}

// ValuesFrom reads cursor values from entity for the given columns.
func (s Schema[F, T]) ValuesFrom(entity *T, cols []Column[F]) []any {
	values := make([]any, len(cols))
	for i, col := range cols {
		values[i] = s.binding(col.Field()).Accessor(entity)
	}
	return values
}

// CoerceCursorValues restores JSON-decoded cursor values to SQL bind types.
func (s Schema[F, T]) CoerceCursorValues(cols []Column[F], raw []any) ([]any, error) {
	if len(cols) != len(raw) {
		return nil, ErrCursorLengthMismatch()
	}

	values := make([]any, len(cols))
	for i, col := range cols {
		binding := s.binding(col.Field())
		if binding.Coerce == nil {
			return nil, ErrMissingFieldCoerce(col.Field())
		}
		coerced, err := binding.Coerce(raw[i])
		if err != nil {
			return nil, err
		}
		values[i] = coerced
	}
	return values, nil
}
