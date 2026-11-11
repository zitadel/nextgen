package sqlite

import (
	"time"
)

func timeFromUnixNano(n int64) time.Time {
	return time.Unix(0, n).UTC()
}

// nullUnixNano converts an optional *time.Time to nil or Unix nanoseconds.
func nullUnixNano(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UnixNano()
}

func nowUnixNano() int64 {
	return time.Now().UTC().UnixNano()
}
