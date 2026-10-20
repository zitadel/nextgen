package domain

import (
	"encoding/json"
	"reflect"
)

// JSONEqual reports whether two JSON documents are structurally equal after
// dropping the named top-level keys. Key order and whitespace do not count.
// Zero values are preserved: `false`, `{}`, and `[]` are real content (e.g.
// `additionalProperties: false` is not the same as omitting the key).
func JSONEqual(a, b []byte, ignoreTopLevel ...string) (bool, error) {
	var av, bv any
	if err := json.Unmarshal(a, &av); err != nil {
		return false, err
	}
	if err := json.Unmarshal(b, &bv); err != nil {
		return false, err
	}
	for _, doc := range []any{av, bv} {
		if m, ok := doc.(map[string]any); ok {
			for _, key := range ignoreTopLevel {
				delete(m, key)
			}
		}
	}
	return reflect.DeepEqual(av, bv), nil
}
