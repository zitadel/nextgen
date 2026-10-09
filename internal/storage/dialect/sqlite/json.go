package sqlite

import (
	"database/sql"
	"encoding/json"
	"reflect"
)

// encodeJSON marshals v to a compact JSON string for SQLite TEXT columns.
// A nil slice is encoded as "[]"; a nil map is encoded as "{}".
func encodeJSON(v any) (string, error) {
	if v != nil {
		rv := reflect.ValueOf(v)
		switch rv.Kind() {
		case reflect.Slice:
			if rv.IsNil() {
				return "[]", nil
			}
		case reflect.Map:
			if rv.IsNil() {
				return "{}", nil
			}
		}
	}
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	if string(b) == "null" {
		return "[]", nil
	}
	return string(b), nil
}

// decodeJSONStrings decodes a JSON TEXT column value into a string slice.
// An empty or zero-value string returns an empty slice.
func decodeJSONStrings(s string) ([]string, error) {
	if s == "" || s == "null" {
		return []string{}, nil
	}
	var v []string
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		return nil, err
	}
	if v == nil {
		return []string{}, nil
	}
	return v, nil
}

// nullJSONBytes converts an optional raw JSON string column to []byte.
func nullJSONBytes(s sql.NullString) []byte {
	if !s.Valid || s.String == "" {
		return nil
	}
	return []byte(s.String)
}
