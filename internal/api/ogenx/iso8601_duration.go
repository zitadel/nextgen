package ogenx

import (
	"time"

	"github.com/zitadel/nextgen/internal/isoduration"
)

// ISODuration is an ogen-compatible JSON type for ISO-8601 durations.
type ISODuration = isoduration.Duration

// ParseISODuration parses raw and returns a time.Duration for callers that
// still use the standard library duration type.
func ParseISODuration(raw string) (time.Duration, error) {
	d, err := isoduration.Parse(raw)
	if err != nil {
		return 0, err
	}
	return d.Std(), nil
}
