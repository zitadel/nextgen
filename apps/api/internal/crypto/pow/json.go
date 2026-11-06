package pow

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"slices"
	"unicode/utf8"
)

var errJSON = errors.New("pow: invalid JSON object")

// exactObject rejects missing/extra/case-aliased/duplicate members before any
// struct decoding. DisallowUnknownFields alone is insufficient: encoding/json
// matches struct field names case-insensitively and accepts duplicates and null.
// Values remain raw so the solution MAC uses the original embedded context.
func exactObject(data []byte, fields ...string) (map[string]json.RawMessage, error) {
	if !utf8.Valid(data) {
		return nil, errJSON
	}
	d := json.NewDecoder(bytes.NewReader(data))
	if token, err := d.Token(); err != nil || token != json.Delim('{') {
		return nil, errJSON
	}
	values := make(map[string]json.RawMessage, len(fields))
	for d.More() {
		token, err := d.Token()
		if err != nil {
			return nil, errJSON
		}
		name, ok := token.(string)
		if !ok || !slices.Contains(fields, name) {
			return nil, errJSON
		}
		if _, duplicate := values[name]; duplicate {
			return nil, errJSON
		}
		var raw json.RawMessage
		if d.Decode(&raw) != nil {
			return nil, errJSON
		}
		values[name] = raw
	}
	if token, err := d.Token(); err != nil || token != json.Delim('}') || len(values) != len(fields) {
		return nil, errJSON
	}
	if err := d.Decode(new(json.RawMessage)); err != io.EOF {
		return nil, errJSON
	}
	return values, nil
}

func stringValue(raw json.RawMessage) (string, bool) {
	var s string
	if json.Unmarshal(raw, &s) != nil || s == "" {
		return "", false
	}
	return s, true
}
