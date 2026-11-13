package database

import "time"

// UTCOrNil normalizes a scanned nullable timestamp the way a scanned required
// one is: Spanner returns UTC while pgx defaults to local. A NULL stays nil.
func UTCOrNil(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	return new(t.UTC())
}
