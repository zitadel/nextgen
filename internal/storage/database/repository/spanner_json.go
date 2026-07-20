package repository

import (
	"encoding/json"

	googspanner "cloud.google.com/go/spanner"
)

// encodeSpannerJSON encodes a JSON document for Spanner JSON columns.
//
// The native Spanner client requires [googspanner.NullJSON] when binding JSON
// parameters. Plain strings work with go-sql-spanner's string encoding option
// but fail on the v2 native-client bridge used by ProjectService seed defaults.
func encodeSpannerJSON(b []byte) any {
	if len(b) == 0 {
		return googspanner.NullJSON{Valid: false}
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		// Fall back to a JSON string value so callers still get a typed param
		// instead of a plain Go string that Spanner rejects for JSON columns.
		return googspanner.NullJSON{Value: string(b), Valid: true}
	}
	return googspanner.NullJSON{Value: v, Valid: true}
}
