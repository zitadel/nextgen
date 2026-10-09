package helpers

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/stretchr/testify/require"
)

func MustMarshal(t *testing.T, v any) string {
	t.Helper()
	m, err := json.Marshal(addressable(v))
	require.NoError(t, err)
	return string(m)
}

// addressable returns a pointer to v when v is not already one.
//
// ogen puts MarshalJSON on pointer receivers. Handed a value, encoding/json
// cannot reach it and walks the struct's fields instead — where every unset
// `Opt*` encodes to nothing and fails the whole marshal with "unexpected end
// of JSON input". Every generated response type has at least one optional
// field, so a caller passing a value rather than a pointer would be reporting
// a marshalling error instead of the assertion it came here to make.
func addressable(v any) any {
	rv := reflect.ValueOf(v)
	if !rv.IsValid() || rv.Kind() == reflect.Pointer {
		return v
	}
	p := reflect.New(rv.Type())
	p.Elem().Set(rv)
	return p.Interface()
}

func MustUnmarshal[T any](t *testing.T, bs []byte) *T {
	t.Helper()
	v := new(T)
	err := json.Unmarshal(bs, v)
	require.NoError(t, err)
	return v
}
