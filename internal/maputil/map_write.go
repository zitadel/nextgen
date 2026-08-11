package maputil

import (
	"errors"
	"fmt"
)

// SetNested writes value at path, creating the intermediate maps it descends
// through. It is the counterpart to [GetNested], and errors when the path
// descends through a value that is not a map. The converse is not guarded: a
// write onto a final segment that holds a map replaces the map.
func SetNested(m map[string]any, path []string, value any) error {
	if len(path) == 0 {
		return errors.New("maputil: empty path")
	}

	for len(path) > 1 {
		key := path[0]
		sub, ok := Get[map[string]any](m, key)
		if !ok {
			if _, taken := m[key]; taken {
				return fmt.Errorf("maputil: %q is not a map", key)
			}
			sub = map[string]any{}
		}
		m[key] = sub
		m, path = sub, path[1:]
	}
	m[path[0]] = value
	return nil
}
