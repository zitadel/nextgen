package database

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

// CoerceStringValue coerces a JSON-decoded value into a string.
func CoerceStringValue(v any) (string, error) {
	switch s := v.(type) {
	case string:
		return s, nil
	default:
		return "", fmt.Errorf("expected string, got %T", v)
	}
}

// CoerceString coerces a JSON-decoded value into a string for SQL binding.
func CoerceString(v any) (any, error) {
	return CoerceStringValue(v)
}

// CoerceTimeValue coerces a JSON-decoded value into a time.Time.
func CoerceTimeValue(v any) (time.Time, error) {
	switch t := v.(type) {
	case time.Time:
		return t, nil
	case string:
		parsed, err := time.Parse(time.RFC3339Nano, t)
		if err != nil {
			parsed, err = time.Parse(time.RFC3339, t)
		}
		if err != nil {
			return time.Time{}, fmt.Errorf("parse time: %w", err)
		}
		return parsed, nil
	default:
		return time.Time{}, fmt.Errorf("expected time, got %T", v)
	}
}

// CoerceTime coerces a JSON-decoded value into a time.Time for SQL binding.
func CoerceTime(v any) (any, error) {
	return CoerceTimeValue(v)
}

// CoerceUint8Value coerces a JSON-decoded value into a uint8-based enum.
func CoerceUint8Value[E ~uint8](v any) (E, error) {
	switch n := v.(type) {
	case E:
		return n, nil
	case float64:
		return E(n), nil
	case string:
		parsed, err := strconv.ParseUint(n, 10, 8)
		if err != nil {
			var zero E
			return zero, fmt.Errorf("parse uint8: %w", err)
		}
		return E(parsed), nil
	default:
		var zero E
		return zero, fmt.Errorf("expected %T, got %T", zero, v)
	}
}

// CoerceUint8 coerces a JSON-decoded value into a uint8-based enum for SQL binding.
func CoerceUint8[E ~uint8](v any) (any, error) {
	return CoerceUint8Value[E](v)
}

// CoerceJSONValue coerces a JSON-decoded value into T via marshal/unmarshal when needed.
func CoerceJSONValue[T any](v any) (T, error) {
	if typed, ok := v.(T); ok {
		return typed, nil
	}

	data, err := json.Marshal(v)
	if err != nil {
		var zero T
		return zero, fmt.Errorf("marshal json value: %w", err)
	}

	var out T
	if err := json.Unmarshal(data, &out); err != nil {
		var zero T
		return zero, fmt.Errorf("unmarshal json value: %w", err)
	}
	return out, nil
}

// CoerceJSON coerces a JSON-decoded value into T for SQL binding.
func CoerceJSON[T any](v any) (any, error) {
	return CoerceJSONValue[T](v)
}

// CoerceEnumKeyMap coerces JSON-decoded map shapes into map[K]V with parsed enum keys.
func CoerceEnumKeyMap[K ~uint8, V any](v any, parseKey func(string) (K, error)) (map[K]V, error) {
	if typed, ok := v.(map[K]V); ok {
		return typed, nil
	}

	data, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("marshal enum key map: %w", err)
	}

	var stringMap map[string]V
	if err := json.Unmarshal(data, &stringMap); err != nil {
		return nil, fmt.Errorf("unmarshal enum key map: %w", err)
	}

	out := make(map[K]V, len(stringMap))
	for key, value := range stringMap {
		parsed, err := parseKey(key)
		if err != nil {
			return nil, fmt.Errorf("parse map key %q: %w", key, err)
		}
		out[parsed] = value
	}
	return out, nil
}

// CoerceEnumKeyMapAsAny adapts CoerceEnumKeyMap for FieldBinding.Coerce.
func CoerceEnumKeyMapAsAny[K ~uint8, V any](parseKey func(string) (K, error)) func(any) (any, error) {
	return func(v any) (any, error) {
		return CoerceEnumKeyMap[K, V](v, parseKey)
	}
}

// CoerceSlice converts JSON-decoded slice shapes into []T.
// It accepts []T (identity) or []any (coerce each element).
func CoerceSlice[T any](v any, coerceElem func(any) (T, error)) ([]T, error) {
	switch s := v.(type) {
	case []T:
		return s, nil
	case []any:
		out := make([]T, len(s))
		for i, item := range s {
			coerced, err := coerceElem(item)
			if err != nil {
				return nil, fmt.Errorf("coerce slice element %d: %w", i, err)
			}
			out[i] = coerced
		}
		return out, nil
	default:
		return nil, fmt.Errorf("expected slice, got %T", v)
	}
}

// CoerceSliceAsAny adapts CoerceSlice for FieldBinding.Coerce.
func CoerceSliceAsAny[T any](coerceElem func(any) (T, error)) func(any) (any, error) {
	return func(v any) (any, error) {
		return CoerceSlice(v, coerceElem)
	}
}
