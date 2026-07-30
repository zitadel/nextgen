package sqlite

import (
	"database/sql"
	"time"
)

func unixNano(t time.Time) int64 {
	return t.UnixNano()
}

func timeFromUnixNano(n int64) time.Time {
	return time.Unix(0, n).UTC()
}

// nullUnixNano converts an optional *time.Time to nil or an int64 nanosecond value
// suitable for a nullable INTEGER column.
func nullUnixNano(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UnixNano()
}

// scanUnixNano writes a NullInt64 database value into a *time.Time.
func scanUnixNano(dest *time.Time, n sql.NullInt64) {
	if n.Valid {
		*dest = timeFromUnixNano(n.Int64)
	}
}

func nowUnixNano() int64 {
	return time.Now().UTC().UnixNano()
}
