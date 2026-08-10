package maputil

import (
	"fmt"
	"strings"
)

// SetNested writes value at the dotted path, creating the intermediate
// maps it descends through. It is the counterpart to [GetNested], and
// errors when the path descends through a value that is not a map.
func SetNested(m map[string]any, path string, value any) error {
	for {
		i := strings.Index(path, ".")
		if i < 0 {
			m[path] = value
			return nil
		}

		key, rest := path[:i], path[i+1:]
		sub, ok := Get[map[string]any](m, key)
		if !ok {
			if _, taken := m[key]; taken {
				return fmt.Errorf("maputil: %q is not a map", key)
			}
			sub = map[string]any{}
		}
		m[key] = sub
		m, path = sub, rest
	}
}
