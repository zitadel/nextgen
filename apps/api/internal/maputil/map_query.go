package maputil

// GetNested reads the value at path, descending one map per segment. An
// empty path addresses nothing and reports false.
func GetNested[T any](m map[string]any, path []string) (value T, ok bool) {
	if len(path) == 0 {
		return *new(T), false
	}
	if len(path) == 1 {
		return Get[T](m, path[0])
	}

	v, ok := Get[map[string]any](m, path[0])
	if !ok {
		return *new(T), false
	}
	return GetNested[T](v, path[1:])
}

func Get[T any](m map[string]any, key string) (value T, ok bool) {
	v, ok := m[key]
	if !ok {
		return *new(T), false
	}
	t, ok := v.(T)
	if !ok {
		return *new(T), false
	}
	return t, true
}
