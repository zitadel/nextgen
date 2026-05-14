package database

import (
	"reflect"
	"slices"
)

type PatchJSONB interface {
	Change
	Column
}

// SetJSONValue creates a new JSON change that sets the given value at the given path in the JSON column.
//
// Example to set a new value at path {"a", "b"} in column "data":
//
//	SetJSONValue(NewColumn("table", "data"), []string{"a", "b"}, "newValue")
//
// Example to remove or reset a value at path {"a", "b"} in column "data":
//
//	SetJSONValue[any](NewColumn("table", "data"), []string{"a", "b"}, nil)
//
// Please see [AppendToJSONArray] and [RemoveFromJSONArray] for changes that add or remove values from JSON arrays.
func SetJSONValue[V Value](col Column, path []string, value V) Change {
	return &setJSONB[V]{
		column: col,
		value:  value,
		path:   path,
	}
}

type setJSONB[V Value] struct {
	column Column
	path   []string
	value  V
}

// WriteArg implements [Change].
func (s setJSONB[V]) WriteArg(builder *StatementBuilder) {
	s.Write(builder)
}

// IsOnColumn implements [Change].
func (s setJSONB[V]) IsOnColumn(col Column) bool {
	return s.column.Equals(col)
}

// Write implements [Change].
func (s setJSONB[V]) Write(builder *StatementBuilder) {
	builder.WriteString("jsonb_set(")
	s.column.WriteQualified(builder)
	builder.WriteString(", ")
	builder.WriteArgs(s.path, s.value)
	builder.WriteString(")")
}

// Equals implements [Column].
func (s *setJSONB[V]) Equals(col Column) bool {
	if col == nil {
		return s == nil
	}
	other, ok := col.(*setJSONB[V])
	if !ok {
		return false
	}
	if !s.column.Equals(other.column) {
		return false
	}
	if !slices.Equal(s.path, other.path) {
		return false
	}
	return reflect.DeepEqual(s.value, other.value)
}

// Matches implements [Change].
func (s *setJSONB[V]) Matches(x any) bool {
	toMatch, ok := x.(*setJSONB[V])
	if !ok {
		return false
	}
	return s.Equals(toMatch)
}

// String implements [Change].
func (s *setJSONB[V]) String() string {
	return "database.setJSONB"
}

// WriteQualified implements [Column].
func (s setJSONB[V]) WriteQualified(builder *StatementBuilder) {
	s.Write(builder)
}

// WriteUnqualified implements [Column].
func (s setJSONB[V]) WriteUnqualified(builder *StatementBuilder) {
	s.Write(builder)
}

var (
	_ PatchJSONB = (*setJSONB[Value])(nil)
)
