package cookie

import "time"

// SetNow replaces the sealer's clock for tests. The production
// constructor does not expose this seam.
func SetNow(s *Sealer, now func() time.Time) {
	s.now = now
}
