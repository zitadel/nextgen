package domain

import (
	"encoding/json"
	"reflect"
)

// JSONEqual reports whether two JSON documents are structurally equal after
// dropping the named top-level keys and, at every depth, keys holding a
// zero value (`false`, `null`, `{}`, `[]`). The server echoes what it stored,
// and it stores omitted booleans as false and omitted objects as empty
// (`"audience": {}`, `"primary": false`); an author's file leaves them out.
// Neither spelling is a change. Key order and whitespace do not count either.
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
	return reflect.DeepEqual(dropZeroJSONValues(av), dropZeroJSONValues(bv)), nil
}

func dropZeroJSONValues(v any) any {
	switch value := v.(type) {
	case map[string]any:
		for key, nested := range value {
			cleaned := dropZeroJSONValues(nested)
			if isZeroJSON(cleaned) {
				delete(value, key)
				continue
			}
			value[key] = cleaned
		}
		return value
	case []any:
		for i, item := range value {
			value[i] = dropZeroJSONValues(item)
		}
		return value
	default:
		return v
	}
}

func isZeroJSON(v any) bool {
	switch value := v.(type) {
	case nil:
		return true
	case bool:
		return !value
	case map[string]any:
		return len(value) == 0
	case []any:
		return len(value) == 0
	default:
		return false
	}
}
