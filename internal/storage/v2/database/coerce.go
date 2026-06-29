package database

import (
	"encoding/json"
	"strconv"
	"time"

	"golang.org/x/exp/constraints"
)

// CoerceStringValue coerces a JSON-decoded value into a string.
func CoerceStringValue(v any) (string, error) {
	switch s := v.(type) {
	case string:
		return s, nil
	default:
		return "", ErrCoerceExpectedType("string", v)
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
			return time.Time{}, ErrCoerceParse("The cursor time value could not be parsed.", err)
		}
		return parsed, nil
	default:
		return time.Time{}, ErrCoerceExpectedType("time", v)
	}
}

// CoerceTime coerces a JSON-decoded value into a time.Time for SQL binding.
func CoerceTime(v any) (any, error) {
	return CoerceTimeValue(v)
}

type Number interface {
	constraints.Float | constraints.Integer | ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64
}

// CoerceNumberValue coerces a JSON-decoded value into a uint8-based enum.
func CoerceNumberValue[E Number](v any) (E, error) {
	switch n := v.(type) {
	case E:
		return n, nil
	case float32, float64, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return n.(E), nil
	case string:
		return parseNumber[E](n)
	default:
		var zero E
		return zero, ErrCoerceExpectedType("uint8 enum", v)
	}
}

// CoerceNumber coerces a JSON-decoded value into a uint8-based enum for SQL binding.
func CoerceNumber[E Number](v any) (any, error) {
	return CoerceNumberValue[E](v)
}

// CoerceJSONValue coerces a JSON-decoded value into T via marshal/unmarshal when needed.
func CoerceJSONValue[T any](v any) (T, error) {
	if typed, ok := v.(T); ok {
		return typed, nil
	}

	data, err := json.Marshal(v)
	if err != nil {
		var zero T
		return zero, ErrCoerceParse("The cursor JSON value could not be marshaled.", err)
	}

	var out T
	if err := json.Unmarshal(data, &out); err != nil {
		var zero T
		return zero, ErrCoerceParse("The cursor JSON value could not be unmarshaled.", err)
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
		return nil, ErrCoerceParse("The cursor enum key map could not be marshaled.", err)
	}

	var stringMap map[string]V
	if err := json.Unmarshal(data, &stringMap); err != nil {
		return nil, ErrCoerceParse("The cursor enum key map could not be unmarshaled.", err)
	}

	out := make(map[K]V, len(stringMap))
	for key, value := range stringMap {
		parsed, err := parseKey(key)
		if err != nil {
			return nil, ErrCoerceEnumMapKey(key, err)
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
				return nil, ErrCoerceSliceElement(i, err)
			}
			out[i] = coerced
		}
		return out, nil
	default:
		return nil, ErrCoerceExpectedSlice(v)
	}
}

// CoerceSliceAsAny adapts CoerceSlice for FieldBinding.Coerce.
func CoerceSliceAsAny[T any](coerceElem func(any) (T, error)) func(any) (any, error) {
	return func(v any) (any, error) {
		return CoerceSlice(v, coerceElem)
	}
}

func parseNumber[E Number](v string) (number E, err error) {
	defer func() {
		if err != nil {
			err = ErrCoerceParse("The cursor number value could not be parsed.", err)
		}
	}()
	switch any(number).(type) {
	case uint8:
		parsed, err := strconv.ParseUint(v, 10, 8)
		return E(parsed), err
	case uint16:
		parsed, err := strconv.ParseUint(v, 10, 16)
		return E(parsed), err
	case uint32:
		parsed, err := strconv.ParseUint(v, 10, 32)
		return E(parsed), err
	case uint, uint64:
		parsed, err := strconv.ParseUint(v, 10, 64)
		return E(parsed), err
	case int8:
		parsed, err := strconv.ParseInt(v, 10, 8)
		return E(parsed), err
	case int16:
		parsed, err := strconv.ParseInt(v, 10, 16)
		return E(parsed), err
	case int32:
		parsed, err := strconv.ParseInt(v, 10, 32)
		return E(parsed), err
	case int, int64:
		parsed, err := strconv.ParseInt(v, 10, 64)
		return E(parsed), err
	case float32:
		parsed, err := strconv.ParseFloat(v, 32)
		return E(parsed), err
	case float64:
		parsed, err := strconv.ParseFloat(v, 64)
		return E(parsed), err
	default:
		return number, ErrCoerceExpectedType("number", v)
	}
}
