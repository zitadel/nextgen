package spanner

import (
	"encoding/json"

	"cloud.google.com/go/spanner"
)

func encodeNullJSON(b []byte) (spanner.NullJSON, error) {
	if len(b) == 0 {
		return spanner.NullJSON{Valid: false}, nil
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return spanner.NullJSON{}, err
	}
	return spanner.NullJSON{Value: v, Valid: true}, nil
}

func decodeNullJSON(v spanner.NullJSON) ([]byte, error) {
	if !v.Valid {
		return nil, nil
	}
	return json.Marshal(v.Value)
}
