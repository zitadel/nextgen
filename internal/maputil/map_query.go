package maputil

import "strings"

func GetNested[T any](m map[string]any, path string) (value T, ok bool) {
	i := strings.Index(path, ".")
	if i < 0 {
		return Get[T](m, path)
	}

	key, rest := path[:i], path[i+1:]
	v, ok := Get[map[string]any](m, key)
	if !ok {
		return *new(T), false
	}
	return GetNested[T](v, rest)
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
