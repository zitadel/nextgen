package maputil

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
